import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '@prisma/client';
import type { Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type { Principal, TokenClaims } from '../auth/principal';
import type { ListUsersDto } from './admin-users.controller';

export interface AdminUserView {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly bootstrapAdminEmail?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.bootstrapAdminEmail = config
      .get('BOOTSTRAP_ADMIN_EMAIL', { infer: true })
      ?.toLowerCase();
  }

  /**
   * Resolves a verified token to a local user, creating the record on first sign-in.
   *
   * The upsert is keyed on the OIDC subject rather than the email, because an email can
   * change at the identity provider while the subject cannot. Doing it as a single upsert
   * rather than find-then-create matters: two concurrent first requests from the same new
   * user would otherwise race, and the unique index would turn the loser into a 500.
   */
  async provisionFromClaims(claims: TokenClaims): Promise<User> {
    const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase();
    const displayName = this.displayNameFrom(claims, email);

    const user = await this.prisma.user.upsert({
      where: { idpSubject: claims.sub },
      // Profile fields are the user's to edit once the account exists, so an existing
      // record is not overwritten from the token on every request.
      update: {},
      create: {
        idpSubject: claims.sub,
        email,
        displayName,
        role: this.isBootstrapAdmin(email) ? UserRole.ADMIN : UserRole.USER,
      },
    });

    if (user.createdAt.getTime() === user.updatedAt.getTime()) {
      this.logger.log(`Provisioned ${user.role.toLowerCase()} account for ${user.email}`);
    }

    return user;
  }

  async list(
    query: ListUsersDto,
  ): Promise<{ items: AdminUserView[]; page: number; pageSize: number; total: number }> {
    const where = {
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { displayName: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: rows, page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Changing a role, with the two ways an administrator can lock everybody out closed off.
   *
   * An administrator cannot demote themselves — the usual accident — and the last
   * remaining administrator cannot be demoted by anyone. The second check runs inside a
   * transaction that locks the administrator rows with SELECT ... FOR UPDATE, because
   * two administrators demoting each other simultaneously would otherwise both read a
   * count of two, both pass the check, and leave the board with none.
   */
  async setRole(id: string, principal: Principal, role: UserRole): Promise<AdminUserView> {
    if (id === principal.userId && role !== UserRole.ADMIN) {
      throw new BadRequestException('You cannot remove your own administrator access.');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({ where: { id, deletedAt: null } });

      if (!target) {
        throw new NotFoundException('That user does not exist.');
      }

      if (target.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
        const admins = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users
           WHERE role = 'ADMIN' AND deleted_at IS NULL AND is_active
           FOR UPDATE
        `;

        if (admins.length <= 1) {
          throw new ConflictException(
            'The last administrator cannot be demoted. Promote someone else first.',
          );
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: { role },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      this.logger.log(`${principal.email} set ${updated.email} to ${role}`);

      return updated;
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  private isBootstrapAdmin(email: string): boolean {
    return this.bootstrapAdminEmail !== undefined && email === this.bootstrapAdminEmail;
  }

  private displayNameFrom(claims: TokenClaims, email: string): string {
    const fromName = claims.name?.trim();
    if (fromName) {
      return fromName;
    }

    const fromParts = [claims.given_name, claims.family_name]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(' ');
    if (fromParts) {
      return fromParts;
    }

    // Last resort: the local part of the email. Never blank — display_name is NOT NULL
    // and a nameless author renders as an empty space in the UI.
    return email.split('@')[0] || 'Unknown user';
  }
}

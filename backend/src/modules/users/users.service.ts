import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '@prisma/client';
import type { Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type { TokenClaims } from '../auth/principal';

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

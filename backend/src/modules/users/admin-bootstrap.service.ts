import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import type { Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { KeycloakAdminClient } from './keycloak-admin.client';

/**
 * Seeds the administrator account at start-up from `BOOTSTRAP_ADMIN_EMAIL` and
 * `BOOTSTRAP_ADMIN_PASSWORD`.
 *
 * Without this the board can reach a state with no administrator at all: the account is
 * only created when somebody signs in with the bootstrap address, and a fresh database
 * has nobody who can reach the admin screens to fix it. Seeding is the difference between
 * "an administrator exists" and "an administrator exists if the right person happens to
 * log in first".
 *
 * An account here is two records that must agree — the Keycloak account that owns the
 * credentials, and the local row that owns the role. Creating either without the other is
 * the bug this is written to avoid, so both are reconciled in one pass and the local row
 * is keyed on the `sub` Keycloak just gave us.
 *
 * Leaving the password unset disables all of this and restores the previous behaviour:
 * the email alone still promotes that person the first time they sign in.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);
  private readonly email?: string;
  private readonly password?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakAdminClient,
    config: ConfigService<Env, true>,
  ) {
    this.email = config.get('BOOTSTRAP_ADMIN_EMAIL', { infer: true })?.trim().toLowerCase();
    this.password = config.get('BOOTSTRAP_ADMIN_PASSWORD', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.email === undefined || this.password === undefined) {
      this.logger.debug('No bootstrap administrator configured; nothing to seed');
      return;
    }

    try {
      await this.seed(this.email, this.password);
    } catch (error) {
      // Deliberately not rethrown. Seeding is a convenience, and a Keycloak that is slow
      // to come up or briefly unreachable is a recoverable dependency failure — turning
      // it into a failed start-up would make the API crash-loop while every request it
      // could have served fails too. The error is logged loudly enough to act on.
      this.logger.error(
        `Could not seed the administrator account: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async seed(email: string, password: string): Promise<void> {
    const account = await this.keycloak.ensureAccount(email, password);

    this.logger.log(
      account.created
        ? `Created the Keycloak account for ${email}`
        : `Keycloak account for ${email} already existed; password reconciled`,
    );

    await this.grantLocalAdmin(account.id, email);
  }

  /**
   * Makes the local row for that Keycloak subject an administrator, creating it if this
   * is a first run.
   *
   * The row is keyed on the subject, never the email, for the same reason
   * `provisionFromClaims` is: the email can change at the identity provider and the
   * subject cannot. Seeding by email would create a second row the next time somebody
   * renamed the address, and the sign-in would land on whichever one it found.
   */
  private async grantLocalAdmin(idpSubject: string, email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { idpSubject } });

    if (existing === null) {
      await this.createAdmin(idpSubject, email);
      return;
    }

    if (existing.role === UserRole.ADMIN && existing.isActive && existing.deletedAt === null) {
      this.logger.debug(`${email} is already an active administrator`);
      return;
    }

    // Reached when the account was demoted, deactivated, or deleted — the states that
    // leave a board with no way back in, and the reason re-running this is a repair and
    // not just a no-op. A deleted row had its address rewritten to keep the unique index
    // satisfied, so restoring it means restoring the email too.
    await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        role: UserRole.ADMIN,
        isActive: true,
        deletedAt: null,
        ...(existing.deletedAt === null
          ? {}
          : { email, displayName: AdminBootstrapService.displayNameFor(email) }),
      },
    });

    this.logger.warn(`Restored administrator access for ${email}`);
  }

  private async createAdmin(idpSubject: string, email: string): Promise<void> {
    // `users_email_key` is unique on lower(email). A row already holding this address
    // under a different subject means the local database and Keycloak disagree about who
    // this person is — usually a seed written against an old realm. Overwriting it would
    // hand one person's authored content to another, so this reports and stops.
    const clash = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { idpSubject: true },
    });

    if (clash !== null) {
      this.logger.error(
        `${email} already exists locally under subject ${clash.idpSubject}, but Keycloak ` +
          `issues ${idpSubject} for it. Not seeding — reconcile the two by hand.`,
      );
      return;
    }

    try {
      await this.prisma.user.create({
        data: {
          idpSubject,
          email,
          displayName: AdminBootstrapService.displayNameFor(email),
          role: UserRole.ADMIN,
        },
      });

      this.logger.log(`Seeded ${email} as an administrator`);
    } catch (error) {
      // Two instances starting together both read no row and both insert. One wins; the
      // other lands here having got exactly the state it wanted.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.debug(`${email} was seeded concurrently by another instance`);
        return;
      }

      throw error;
    }
  }

  /** `display_name` is NOT NULL and a nameless author renders as a blank in the UI. */
  private static displayNameFor(email: string): string {
    return email.split('@')[0] || 'Administrator';
  }
}

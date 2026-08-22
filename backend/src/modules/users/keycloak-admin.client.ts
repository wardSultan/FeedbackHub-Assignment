import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../platform/config/env';

export interface EnsuredAccount {
  /** The Keycloak user id, which is the `sub` claim its tokens will carry. */
  id: string;
  /** True when this call created the account rather than finding it. */
  created: boolean;
}

interface KeycloakUser {
  id: string;
}

/**
 * The slice of Keycloak's Admin REST API the administrator bootstrap needs, and nothing
 * else — find a user, create a user, set a password.
 *
 * Holding realm-administrator credentials in the API is a real expansion of what this
 * process is trusted with, so it is confined to this one class where it is obvious what
 * has access to them. The credentials are only ever sent to the configured Keycloak base
 * URL, and the token they buy lives for the length of one bootstrap rather than being
 * cached for the process lifetime.
 *
 * Every call is bounded by a timeout: a Keycloak that accepts the connection and then
 * never answers would otherwise hang start-up indefinitely.
 */
@Injectable()
export class KeycloakAdminClient {
  private static readonly TIMEOUT_MS = 10_000;

  private readonly logger = new Logger(KeycloakAdminClient.name);
  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly username: string;
  private readonly password?: string;

  constructor(config: ConfigService<Env, true>) {
    const issuer = new URL(config.get('KEYCLOAK_ISSUER_URL', { infer: true }));

    // The issuer is the browser-facing URL and is not necessarily routable from here, so
    // an explicit base URL wins. Falling back to the issuer's origin covers local
    // development, where the API and the browser reach Keycloak by the same name.
    const configured = config.get('KEYCLOAK_BASE_URL', { infer: true });
    this.baseUrl = (configured ?? issuer.origin).replace(/\/+$/, '');

    // `https://host/realms/feedbackhub` — the realm is the last path segment. Derived
    // from the issuer rather than configured separately, because a realm that disagreed
    // with the issuer would seed the account into a realm whose tokens are then rejected.
    this.realm = issuer.pathname.split('/').filter(Boolean).pop() ?? '';
    this.username = config.get('KEYCLOAK_ADMIN_USERNAME', { infer: true });
    this.password = config.get('KEYCLOAK_ADMIN_PASSWORD', { infer: true });
  }

  /**
   * Creates the account if it is absent, then sets its password.
   *
   * Idempotent by design: this runs on every start-up, so it has to converge on the same
   * state rather than accumulate accounts or fail the second time.
   */
  async ensureAccount(email: string, password: string): Promise<EnsuredAccount> {
    const token = await this.adminToken();

    const existing = await this.findByEmail(token, email);
    const id = existing ?? (await this.createUser(token, email, password));

    // Done even for an account created a line ago with an inline credential, because the
    // alternative is worse: a realm imported with a different password for this address
    // would be left alone, and the value in the environment would stop being the truth.
    await this.setPassword(token, id, password);

    return { id, created: existing === null };
  }

  private async adminToken(): Promise<string> {
    if (this.password === undefined) {
      throw new Error('KEYCLOAK_ADMIN_PASSWORD is not set');
    }

    // `admin-cli` is the public client every realm ships for exactly this purpose, and
    // the master realm is where a server-wide administrator lives.
    const response = await this.request(
      '/realms/master/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: this.username,
          password: this.password,
        }),
      },
      'authenticate as the realm administrator',
    );

    const payload = (await response.json()) as { access_token?: string };

    if (!payload.access_token) {
      throw new Error('Keycloak returned no access token for the administrator');
    }

    return payload.access_token;
  }

  private async findByEmail(token: string, email: string): Promise<string | null> {
    // `exact=true` matters: without it Keycloak treats the value as an infix search, and
    // the lookup for `admin@example.com` also matches `not-admin@example.com.evil.net`.
    const query = new URLSearchParams({ email, exact: 'true', max: '2' });
    const response = await this.request(
      `/admin/realms/${this.realm}/users?${query.toString()}`,
      { headers: { authorization: `Bearer ${token}` } },
      `look up ${email}`,
    );

    const users = (await response.json()) as KeycloakUser[];

    if (users.length > 1) {
      throw new Error(`Keycloak has more than one account for ${email}`);
    }

    return users[0]?.id ?? null;
  }

  private async createUser(token: string, email: string, password: string): Promise<string> {
    const response = await this.request(
      `/admin/realms/${this.realm}/users`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          username: email,
          email,
          // Nothing in this stack sends mail, so an unverified account would be a
          // sign-in that can never be completed.
          emailVerified: true,
          enabled: true,
          credentials: [{ type: 'password', value: password, temporary: false }],
        }),
      },
      `create ${email}`,
      // Two API instances starting together both see no account and both try to create
      // one. The loser gets a 409, and the account it wanted now exists — which is the
      // goal, so this is a tolerated status rather than a failure.
      [409],
    );

    if (response.status === 409) {
      const existing = await this.findByEmail(token, email);

      if (existing === null) {
        throw new Error(`Keycloak rejected ${email} as a duplicate but has no such account`);
      }

      return existing;
    }

    // Keycloak answers 201 with an empty body and the new id at the end of Location.
    const id = response.headers.get('location')?.split('/').filter(Boolean).pop();

    if (!id) {
      throw new Error('Keycloak created the account but returned no id');
    }

    return id;
  }

  private async setPassword(token: string, id: string, password: string): Promise<void> {
    await this.request(
      `/admin/realms/${this.realm}/users/${id}/reset-password`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'password', value: password, temporary: false }),
      },
      'set the administrator password',
    );
  }

  /**
   * The one place every response is checked, so no call site can forget: `fetch` does not
   * throw on 4xx or 5xx, and a bare `await fetch(...)` treats "403 Forbidden" as success.
   */
  private async request(
    path: string,
    init: RequestInit,
    what: string,
    tolerate: number[] = [],
  ): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(KeycloakAdminClient.TIMEOUT_MS),
      });
    } catch (cause) {
      throw new Error(`Could not reach Keycloak at ${this.baseUrl} to ${what}`, { cause });
    }

    if (!response.ok && !tolerate.includes(response.status)) {
      // The body usually explains the refusal ("User exists with same username"). It is
      // logged at debug rather than raised, because it is Keycloak's wording and the
      // message this throws is the one an operator needs.
      const detail = await response.text().catch(() => '');
      this.logger.debug(`HTTP ${response.status} from ${path}: ${detail}`);

      throw new Error(`Keycloak refused to ${what} (HTTP ${response.status})`);
    }

    return response;
  }
}

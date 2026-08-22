import { Injectable, inject } from '@angular/core';
import { AuthConfig, OAuthService } from 'angular-oauth2-oidc';
import { RUNTIME_CONFIG } from '../config/runtime-config';

/**
 * Authorization code flow with PKCE against Keycloak.
 *
 * A public client with no secret, because a browser cannot keep one. The access token is
 * held in memory by the library rather than in localStorage: a token in localStorage is
 * readable by any script that manages to run on the page, which turns an XSS into a stolen
 * session. The trade-off is that a refresh costs a silent renew, which is the right side
 * of that trade for an internal tool.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly oauth = inject(OAuthService);
  private readonly config = inject(RUNTIME_CONFIG);

  async initialise(): Promise<void> {
    const authConfig: AuthConfig = {
      issuer: this.config.keycloak.issuer,
      clientId: this.config.keycloak.clientId,
      redirectUri: `${window.location.origin}/`,
      postLogoutRedirectUri: `${window.location.origin}/`,
      responseType: 'code',
      scope: 'openid profile email',
      requireHttps: false,
      showDebugInformation: false,
      useSilentRefresh: false,
      // Rotating refresh tokens: a stolen one is usable once, and reuse invalidates the
      // chain rather than granting indefinite access.
      useIdTokenHintForSilentRefresh: true,
    };

    this.oauth.configure(authConfig);
    this.oauth.setupAutomaticSilentRefresh();

    await this.oauth.loadDiscoveryDocumentAndTryLogin();
  }

  get accessToken(): string | null {
    return this.oauth.getAccessToken() || null;
  }

  get hasValidToken(): boolean {
    return this.oauth.hasValidAccessToken();
  }

  /**
   * Starts the redirect to Keycloak.
   *
   * `idpHint` is Keycloak's `kc_idp_hint`: it skips the realm's login form and goes
   * straight to that identity provider, which is what makes a "Continue with Google"
   * button land on Google rather than on a page with a Google button on it. Omitted, the
   * realm's own login page is shown, which is where email and password are entered.
   */
  signIn(idpHint?: string): void {
    this.oauth.initCodeFlow(undefined, idpHint ? { kc_idp_hint: idpHint } : {});
  }

  get googleSsoEnabled(): boolean {
    // Defaulted rather than assumed present: `config.json` is written by the container
    // entrypoint in Docker but is a hand-maintained file for `ng serve`, so a copy
    // predating this flag must read as "off" rather than as `undefined`.
    return this.config.keycloak.googleSso ?? false;
  }

  signOut(): void {
    this.oauth.logOut();
  }
}

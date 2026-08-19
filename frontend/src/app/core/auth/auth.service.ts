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

  signIn(): void {
    this.oauth.initCodeFlow();
  }

  signOut(): void {
    this.oauth.logOut();
  }
}

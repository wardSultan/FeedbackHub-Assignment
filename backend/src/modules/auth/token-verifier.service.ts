import { Injectable, Logger, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from '../../platform/config/env';
import type { TokenClaims } from './principal';

/**
 * Verifies access tokens against the identity provider's published keys.
 *
 * This is integration, not an authentication primitive: no credential is handled, no
 * token is minted. The alternative to verifying a token is trusting an unverified one,
 * which is the vulnerability the brief's "do not implement authentication primitives"
 * instruction exists to prevent. See docs/SCOPE.md, A-3.
 */
@Injectable()
export class TokenVerifierService implements OnModuleInit {
  private readonly logger = new Logger(TokenVerifierService.name);
  private readonly issuer: string;
  private readonly audience: string;
  private jwks!: JWTVerifyGetKey;

  constructor(config: ConfigService<Env, true>) {
    this.issuer = config.get('KEYCLOAK_ISSUER_URL', { infer: true });
    this.audience = config.get('KEYCLOAK_AUDIENCE', { infer: true });
  }

  onModuleInit(): void {
    // Fetched lazily on first use and cached, with jose handling key rotation and
    // cooldown. Building it here rather than per request avoids a JWKS fetch per call.
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/protocol/openid-connect/certs`));
    this.logger.log(`Verifying tokens issued by ${this.issuer}`);
  }

  async verify(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        // Pinning the algorithm is what closes off `alg: none` and the family of
        // algorithm-confusion attacks. Never take the algorithm from the token.
        algorithms: ['RS256'],
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token has no subject');
      }

      return payload as unknown as TokenClaims;
    } catch (error) {
      // The reason is logged but never returned: telling a caller *why* their token was
      // rejected helps them forge a better one.
      this.logger.debug(`Token rejected: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }
}

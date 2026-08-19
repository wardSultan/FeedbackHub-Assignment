import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenVerifierService } from './token-verifier.service';

/**
 * Applied globally. Verifies the bearer token, resolves it to a local user, and attaches
 * the principal to the request.
 *
 * Public routes still populate the principal when a valid token is present, so a read
 * endpoint can personalise its response (has this user voted?) without becoming
 * authenticated-only.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifierService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerTokenFrom(request.headers.authorization);

    if (!token) {
      if (isPublic) {
        return true;
      }
      throw new UnauthorizedException('Authentication is required.');
    }

    const claims = await this.tokenVerifier.verify(token);
    const user = await this.users.provisionFromClaims(claims);

    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException('This account is no longer active.');
    }

    request.principal = {
      userId: user.id,
      idpSubject: user.idpSubject,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };

    return true;
  }

  private bearerTokenFrom(header: string | undefined): string | null {
    if (!header) {
      return null;
    }

    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}

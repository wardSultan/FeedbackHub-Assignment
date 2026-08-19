import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from './principal';

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

/**
 * Injects the authenticated principal.
 *
 * Always derived from the verified token — never from a route parameter, header or body
 * field. That is what makes "users can only modify their own content" enforceable: there
 * is no user identifier in the request for a caller to tamper with.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);

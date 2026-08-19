import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Principal } from './principal';

/** Anything with an author. Keeps these rules independent of any one entity. */
export interface Owned {
  authorId: string;
}

export const isAdmin = (principal: Principal): boolean => principal.role === UserRole.ADMIN;

export const isAuthor = (principal: Principal, resource: Owned): boolean =>
  resource.authorId === principal.userId;

/**
 * Editing the *text* of something is the author's alone.
 *
 * An admin moderating content may remove it, but may not rewrite it and leave it
 * attributed to someone else. The brief grants admins triage and moderation, never
 * impersonation, and silently widening that is how "admin edited my comment to say
 * something I did not write" becomes possible.
 */
export function assertCanEditContent(principal: Principal, resource: Owned): void {
  if (!isAuthor(principal, resource)) {
    throw new ForbiddenException('Only the author can edit this.');
  }
}

/** Deleting is the author's right and the admin's moderation duty. */
export function assertCanDelete(principal: Principal, resource: Owned): void {
  if (!isAuthor(principal, resource) && !isAdmin(principal)) {
    throw new ForbiddenException('Only the author or an administrator can delete this.');
  }
}

/** Admin-only fields: status, pinning, taxonomy, application settings. */
export function assertIsAdmin(principal: Principal): void {
  if (!isAdmin(principal)) {
    throw new ForbiddenException('This action requires administrator access.');
  }
}

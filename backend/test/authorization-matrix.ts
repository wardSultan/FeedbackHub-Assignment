/**
 * The authorization matrix.
 *
 * One row per endpoint, stating who may call it. This is the single place the access
 * rules are written down, and two things consume it:
 *
 *  - `route-audit.ts` checks it against the controllers *statically*: every route has a
 *    row, every row has a route, and the decorators on each handler agree with what the
 *    row claims. It runs without installing anything.
 *  - `authorization.e2e-spec.ts` generates one request per (route × caller) and asserts
 *    the status, checking the same claims at runtime against a live API.
 *
 * The reason for a table rather than hand-written tests: the failure mode being guarded
 * against is a *missing* test, not a wrong one. A new endpoint added without an
 * authorization decision fails the audit immediately, where it would simply be absent from
 * a hand-written suite and nobody would notice.
 */

export type Access =
  /** No token needed. */
  | 'public'
  /** Any signed-in user. */
  | 'authenticated'
  /** Signed in, and the row is enforced further down by an ownership check. */
  | 'owner-or-admin'
  /** Signed in, author only — an administrator is refused too. */
  | 'owner-only'
  /** Administrators only, enforced by a role guard at the route. */
  | 'admin';

export interface RouteRule {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  access: Access;
  /** Feature flag that must be enabled, or the route returns 403 regardless of the caller. */
  feature?: string;
  /** Why this rule is what it is, where that is not self-evident. */
  note?: string;
}

export const AUTHORIZATION_MATRIX: RouteRule[] = [
  // --- Platform ------------------------------------------------------------
  { method: 'GET', path: '/health/live', access: 'public' },
  { method: 'GET', path: '/health/ready', access: 'public' },
  {
    method: 'GET',
    path: '/bootstrap',
    access: 'public',
    note: 'An anonymous client needs the same shape to render the shell; it gets user: null.',
  },

  // --- Taxonomy (read) -----------------------------------------------------
  { method: 'GET', path: '/categories', access: 'authenticated' },
  { method: 'GET', path: '/statuses', access: 'authenticated' },

  // --- Feedback requests ---------------------------------------------------
  { method: 'GET', path: '/requests', access: 'authenticated' },
  { method: 'GET', path: '/requests/:id', access: 'authenticated' },
  { method: 'POST', path: '/requests', access: 'authenticated' },
  {
    method: 'PATCH',
    path: '/requests/:id',
    access: 'owner-only',
    note: 'Content is the author’s. An administrator may delete it but may not rewrite it.',
  },
  { method: 'DELETE', path: '/requests/:id', access: 'owner-or-admin' },
  { method: 'PATCH', path: '/requests/:id/status', access: 'admin' },
  { method: 'PATCH', path: '/requests/:id/pin', access: 'admin' },

  // --- Votes ---------------------------------------------------------------
  {
    method: 'POST',
    path: '/requests/:id/vote',
    access: 'authenticated',
    note: 'The composite primary key is the ownership rule; there is no id to tamper with.',
  },
  { method: 'DELETE', path: '/requests/:id/vote', access: 'authenticated' },

  // --- Comments ------------------------------------------------------------
  {
    method: 'GET',
    path: '/requests/:requestId/comments',
    access: 'authenticated',
    feature: 'comments.enabled',
  },
  {
    method: 'POST',
    path: '/requests/:requestId/comments',
    access: 'authenticated',
    feature: 'comments.enabled',
  },
  {
    method: 'PATCH',
    path: '/comments/:id',
    access: 'owner-only',
    feature: 'comments.enabled',
    note: 'Moderation is not impersonation: an administrator cannot edit another’s words.',
  },
  {
    method: 'DELETE',
    path: '/comments/:id',
    access: 'owner-or-admin',
    feature: 'comments.enabled',
  },

  // --- The signed-in user --------------------------------------------------
  { method: 'GET', path: '/me', access: 'authenticated' },
  { method: 'PATCH', path: '/me', access: 'authenticated' },
  { method: 'DELETE', path: '/me', access: 'authenticated' },
  { method: 'GET', path: '/me/settings', access: 'authenticated' },
  { method: 'PATCH', path: '/me/settings', access: 'authenticated' },

  // --- Administration ------------------------------------------------------
  { method: 'GET', path: '/admin/categories', access: 'admin' },
  { method: 'POST', path: '/admin/categories', access: 'admin' },
  { method: 'PATCH', path: '/admin/categories/:id', access: 'admin' },
  { method: 'DELETE', path: '/admin/categories/:id', access: 'admin' },
  { method: 'GET', path: '/admin/statuses', access: 'admin' },
  { method: 'POST', path: '/admin/statuses', access: 'admin' },
  { method: 'PATCH', path: '/admin/statuses/:id', access: 'admin' },
  { method: 'DELETE', path: '/admin/statuses/:id', access: 'admin' },
  {
    method: 'GET',
    path: '/admin/comments/pending',
    access: 'admin',
    note: 'Deliberately not feature-gated: turning comments off must not strand the queue.',
  },
  { method: 'PATCH', path: '/admin/comments/:id/moderation', access: 'admin' },
  { method: 'GET', path: '/admin/users', access: 'admin' },
  { method: 'PATCH', path: '/admin/users/:id/role', access: 'admin' },
  { method: 'GET', path: '/admin/settings', access: 'admin' },
  { method: 'PATCH', path: '/admin/settings', access: 'admin' },
  { method: 'GET', path: '/admin/feature-flags', access: 'admin' },
  { method: 'PATCH', path: '/admin/feature-flags/:key', access: 'admin' },
];

/** Expected status per caller, derived from the access level rather than restated per row. */
export type Caller = 'anonymous' | 'user' | 'otherUser' | 'author' | 'admin';

export function expectedStatus(rule: RouteRule, caller: Caller, ok = 200): number {
  if (caller === 'anonymous') {
    return rule.access === 'public' ? ok : 401;
  }

  switch (rule.access) {
    case 'public':
    case 'authenticated':
      return ok;
    case 'admin':
      return caller === 'admin' ? ok : 403;
    case 'owner-only':
      // The author, and only the author. An administrator is refused here on purpose.
      return caller === 'author' ? ok : 403;
    case 'owner-or-admin':
      return caller === 'author' || caller === 'admin' ? ok : 403;
  }
}

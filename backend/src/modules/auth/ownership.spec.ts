import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { assertCanDelete, assertCanEditContent, assertIsAdmin } from './ownership';
import type { Principal } from './principal';

const principal = (userId: string, role: UserRole): Principal => ({
  userId,
  idpSubject: `sub-${userId}`,
  email: `${userId}@example.test`,
  displayName: userId,
  role,
});

const author = principal('alice', UserRole.USER);
const otherUser = principal('bob', UserRole.USER);
const admin = principal('ada', UserRole.ADMIN);
const adminAuthor = principal('alice', UserRole.ADMIN);

const resource = { authorId: 'alice' };

describe('content editing', () => {
  it('allows the author', () => {
    expect(() => assertCanEditContent(author, resource)).not.toThrow();
  });

  it('refuses a different user', () => {
    expect(() => assertCanEditContent(otherUser, resource)).toThrow(ForbiddenException);
  });

  // The rule most likely to be got wrong by treating "admin" as "can do anything".
  it('refuses an admin who is not the author — moderation is not impersonation', () => {
    expect(() => assertCanEditContent(admin, resource)).toThrow(ForbiddenException);
  });

  it('allows an admin who is the author', () => {
    expect(() => assertCanEditContent(adminAuthor, resource)).not.toThrow();
  });
});

describe('deletion', () => {
  it('allows the author', () => {
    expect(() => assertCanDelete(author, resource)).not.toThrow();
  });

  it('allows an admin who is not the author', () => {
    expect(() => assertCanDelete(admin, resource)).not.toThrow();
  });

  it('refuses a different non-admin user', () => {
    expect(() => assertCanDelete(otherUser, resource)).toThrow(ForbiddenException);
  });
});

describe('admin-only actions', () => {
  it('allows an admin', () => {
    expect(() => assertIsAdmin(admin)).not.toThrow();
  });

  it('refuses a regular user', () => {
    expect(() => assertIsAdmin(author)).toThrow(ForbiddenException);
  });
});

describe('ownership is decided by user id, not by display name or email', () => {
  it('refuses a user whose email matches but whose id does not', () => {
    const impostor: Principal = { ...otherUser, email: author.email, displayName: author.displayName };
    expect(() => assertCanEditContent(impostor, resource)).toThrow(ForbiddenException);
  });
});

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BootstrapService } from '../config/bootstrap.service';
import { AuthService } from './auth.service';

/**
 * These guards are a convenience, not a security control.
 *
 * They stop a pointless navigation to a page the caller cannot use. Every route they
 * protect has a server-side counterpart that decides the same question again, because a
 * guard runs in code the user controls.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);

  if (auth.hasValidToken) {
    return true;
  }

  auth.signIn();
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const bootstrap = inject(BootstrapService);
  const router = inject(Router);

  return bootstrap.isAdmin() ? true : router.createUrlTree(['/requests']);
};

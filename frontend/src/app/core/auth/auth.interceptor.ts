import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { RUNTIME_CONFIG } from '../config/runtime-config';
import { AuthService } from './auth.service';

/**
 * Attaches the bearer token — and only to our own API.
 *
 * The origin check is the point. An interceptor that attaches the token to every outgoing
 * request will happily hand it to any third-party host the application ever calls, which
 * is a credential leak with no error message.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(RUNTIME_CONFIG);
  const auth = inject(AuthService);
  const token = auth.accessToken;

  if (!token || !request.url.startsWith(config.apiUrl)) {
    return next(request);
  }

  return next(
    request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
  );
};

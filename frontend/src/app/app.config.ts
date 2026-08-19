import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideOAuthClient } from 'angular-oauth2-oidc';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { BootstrapService } from './core/config/bootstrap.service';
import { RUNTIME_CONFIG, type RuntimeConfig } from './core/config/runtime-config';
import { ThemeService } from './core/theme/theme.service';

export function buildAppConfig(config: RuntimeConfig): ApplicationConfig {
  return {
    providers: [
      { provide: RUNTIME_CONFIG, useValue: config },
      provideRouter(
        routes,
        withComponentInputBinding(),
        withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      ),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideAnimationsAsync(),
      provideOAuthClient({
        resourceServer: { allowedUrls: [config.apiUrl], sendAccessToken: false },
      }),

      /**
       * Two awaits before the first render, and no more.
       *
       * The identity library has to process a redirect back from Keycloak before anything
       * can know who the user is, and /bootstrap needs that answer. Those two are genuinely
       * sequential. Everything else the application needs — settings, feature flags,
       * categories, statuses — travels inside that single /bootstrap response rather than
       * as four more round trips behind it.
       */
      provideAppInitializer(async () => {
        const auth = inject(AuthService);
        const bootstrap = inject(BootstrapService);
        // Instantiated here so the theme is applied from the first paint rather than when
        // the first component that injects it happens to be created.
        inject(ThemeService);

        await auth.initialise();
        await bootstrap.load();
      }),
    ],
  };
}

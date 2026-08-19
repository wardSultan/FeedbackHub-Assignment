import { InjectionToken } from '@angular/core';

/**
 * Configuration that differs per environment and is *not* baked into the bundle.
 *
 * `config.json` is written by the container's entrypoint from environment variables at
 * start-up, so the same built image runs against a local Keycloak, a staging realm or
 * production without being rebuilt. Angular's `environment.ts` files do the opposite:
 * they resolve at build time, which means one image per environment and a rebuild to
 * change an API URL.
 */
export interface RuntimeConfig {
  apiUrl: string;
  keycloak: {
    issuer: string;
    clientId: string;
  };
}

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG');

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/config.json', { cache: 'no-store' });

  if (!response.ok) {
    // Nothing can work without this, and a half-configured application that fails later
    // with a confusing error is worse than one that refuses to start with a clear one.
    throw new Error(
      `Could not load /config.json (${response.status}). The web container writes this ` +
        `file at start-up from its environment variables.`,
    );
  }

  return (await response.json()) as RuntimeConfig;
}

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { buildAppConfig } from './app/app.config';
import { loadRuntimeConfig } from './app/core/config/runtime-config';

/**
 * Runtime configuration is fetched *before* Angular starts, rather than inside an
 * initialiser.
 *
 * The API URL and the Keycloak issuer are needed to construct the services that would
 * otherwise be doing the fetching, so resolving them first removes a circular dependency
 * instead of working around one.
 */
loadRuntimeConfig()
  .then((config) => bootstrapApplication(AppComponent, buildAppConfig(config)))
  .catch((error: unknown) => {
    // Before Angular exists there is no error handler and no rendered page, so this is
    // written straight into the document. A blank screen with a console error is the worst
    // possible failure for whoever is trying to run this for the first time.
    document.body.innerHTML = `
      <div style="font: 16px/1.5 system-ui; padding: 2rem; max-width: 40rem; margin: 0 auto">
        <h1 style="font-size: 1.25rem">FeedbackHub could not start</h1>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
        <p style="color:#666">Check that the API and Keycloak are running: <code>docker compose up -d</code></p>
      </div>`;
  });

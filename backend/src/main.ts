import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './platform/config/env';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter';
import { createValidationPipe } from './platform/http/validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  app.use(helmet());

  // Explicit allowlist, no wildcard. Credentials are off because the API is called with
  // a bearer token rather than a cookie, so there is no ambient authority to protect.
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: false,
  });

  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Lets Nest run onModuleDestroy hooks on SIGTERM so in-flight requests drain and the
  // database pool closes cleanly when an orchestrator rolls the pod.
  app.enableShutdownHooks();

  if (nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('FeedbackHub API')
        .setDescription(
          'Internal product feedback board.\n\n' +
            'This API is an OAuth2 resource server: it verifies bearer tokens and never ' +
            'sees a password, so there is no sign-in or registration endpoint here. ' +
            'Keycloak issues the tokens — sign in through the web application, or take ' +
            'one from the realm directly, then paste it into **Authorize** above.',
        )
        .setVersion('1')
        // Declares the scheme the `@ApiBearerAuth()` on every controller refers to.
        // Without it those references name a scheme the document does not define, and
        // Swagger UI renders no Authorize button at all — every protected endpoint then
        // answers 401 from "Try it out", which reads as broken auth rather than a
        // missing token. The name is the default `bearer` the decorator uses.
        .addBearerAuth({
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token issued by the Keycloak realm.',
        })
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      // Survives the page reload that "Try it out" triggers, so the token is pasted once
      // per session rather than once per request.
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  new Logger('Bootstrap').log(`FeedbackHub API listening on port ${port} [${nodeEnv}]`);
}

void bootstrap();

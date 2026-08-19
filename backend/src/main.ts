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
        .setDescription('Internal product feedback board.')
        .setVersion('1')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  new Logger('Bootstrap').log(`FeedbackHub API listening on port ${port} [${nodeEnv}]`);
}

void bootstrap();

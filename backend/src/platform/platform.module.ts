import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Cross-cutting infrastructure: configuration, database access and health probes.
 *
 * This is the shared kernel every domain module sits on top of. It deliberately contains
 * no business rules — anything that knows what a feedback request *is* belongs in a
 * domain module, not here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class PlatformModule {}

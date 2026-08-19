import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenVerifierService } from './token-verifier.service';

/**
 * Authentication and authorization.
 *
 * Both guards are registered globally, in order: authenticate, then check the role. Deny
 * by default — a route without `@Public()` requires a valid token, so a forgotten
 * decorator fails closed.
 */
@Module({
  imports: [UsersModule],
  providers: [
    TokenVerifierService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenVerifierService],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminUsersController } from './admin-users.controller';
import { KeycloakAdminClient } from './keycloak-admin.client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * `AdminBootstrapService` is a provider with no consumer on purpose: it exists for its
 * `onApplicationBootstrap` hook, which Nest calls once the module graph is up.
 */
@Module({
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, KeycloakAdminClient, AdminBootstrapService],
  exports: [UsersService],
})
export class UsersModule {}

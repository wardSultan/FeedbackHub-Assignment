import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FeatureFlagGuard } from './feature-flag.guard';
import { SettingsService } from './settings.service';

/**
 * Global because configuration is read from several modules and threading an import
 * through each of them would add ceremony without adding a boundary.
 */
@Global()
@Module({
  providers: [SettingsService, { provide: APP_GUARD, useClass: FeatureFlagGuard }],
  exports: [SettingsService],
})
export class SettingsModule {}

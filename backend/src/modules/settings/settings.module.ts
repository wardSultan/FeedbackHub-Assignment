import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { AdminSettingsController } from './admin-settings.controller';
import { BootstrapController } from './bootstrap.controller';
import { FeatureFlagGuard } from './feature-flag.guard';
import { SettingsService } from './settings.service';

/**
 * Global because configuration is read from several modules and threading an import
 * through each of them would add ceremony without adding a boundary.
 *
 * It imports TaxonomyModule for one reason: the bootstrap payload carries the taxonomy, so
 * that a client does not have to fetch categories and statuses separately on startup. The
 * dependency points one way — taxonomy knows nothing about settings.
 */
@Global()
@Module({
  imports: [TaxonomyModule],
  controllers: [BootstrapController, AdminSettingsController],
  providers: [SettingsService, { provide: APP_GUARD, useClass: FeatureFlagGuard }],
  exports: [SettingsService],
})
export class SettingsModule {}

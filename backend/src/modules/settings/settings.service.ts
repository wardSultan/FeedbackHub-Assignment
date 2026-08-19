import { Injectable, NotFoundException } from '@nestjs/common';
import { AppSettings } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';

/**
 * Reads global configuration and feature flags.
 *
 * Deliberately uncached. Both are single-row primary-key lookups against a table with a
 * handful of rows, on a board serving an internal team — a cache here would buy nothing
 * measurable and would introduce the one thing a runtime toggle must not have, which is a
 * window where an administrator has flipped a flag and the application has not noticed.
 * If a real hot path ever appears, that is the moment to measure and add one.
 *
 * The admin write endpoints arrive with the settings phase; this is the read side that
 * comments and feature gating need now.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAppSettings(): Promise<AppSettings> {
    const settings = await this.prisma.appSettings.findFirst();

    if (!settings) {
      // The migration seeds this row, so its absence means the database was not migrated
      // rather than that anything the caller did was wrong.
      throw new NotFoundException('Application settings have not been initialised.');
    }

    return settings;
  }

  /**
   * Unknown keys are disabled rather than enabled. A flag that has been removed from the
   * database, or misspelled at the call site, must not silently open a feature.
   */
  async isFeatureEnabled(key: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });

    return flag?.enabled ?? false;
  }

  async getFeatureFlags(): Promise<Record<string, boolean>> {
    const flags = await this.prisma.featureFlag.findMany({
      select: { key: true, enabled: true },
      orderBy: { key: 'asc' },
    });

    return Object.fromEntries(flags.map((flag) => [flag.key, flag.enabled]));
  }
}

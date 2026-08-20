import { Injectable, NotFoundException } from '@nestjs/common';
import { AppSettings, Prisma, UserSettings } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type { UpdateAppSettingsDto, UpdateUserSettingsDto } from './dto/settings.dto';
import {
  resolveSettings,
  type EffectiveSettings,
  type GlobalDefaults,
  type UserOverrides,
} from './settings-resolution';

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

  /**
   * Returns the raw overrides alongside the effective values.
   *
   * The settings screen is the one place that genuinely needs both layers: without the
   * overrides it cannot tell "Dark, because you chose it" from "Dark, because that is the
   * default", and it cannot offer a working "reset to default" control.
   */
  async getUserSettings(
    userId: string,
  ): Promise<{ overrides: UserOverrides; effective: EffectiveSettings }> {
    const [app, row] = await Promise.all([
      this.prisma.appSettings.findFirst(),
      this.prisma.userSettings.findUnique({ where: { userId } }),
    ]);

    const overrides = this.toOverrides(row);

    return { overrides, effective: resolveSettings(this.toGlobalDefaults(app), overrides) };
  }

  /**
   * The row is created lazily. A user who has never changed a setting has no row at all,
   * which is the same thing as a row of NULLs — and not writing one keeps "has this person
   * ever expressed a preference" answerable.
   */

async updateUserSettings(
  userId: string,
  dto: UpdateUserSettingsDto,
): Promise<{ overrides: UserOverrides; effective: EffectiveSettings }> {
  const data = {
    theme: dto.theme,
    language: dto.language,
    defaultSort: dto.defaultSort,

    defaultFilters:
      dto.defaultFilters === null
        ? Prisma.DbNull
        : dto.defaultFilters !== undefined
          ? (dto.defaultFilters as Prisma.InputJsonValue)
          : undefined,

    notifyOnComment: dto.notifyOnComment,
  };

  await this.prisma.userSettings.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data,
    },
  });

  return this.getUserSettings(userId);
}
async updateAppSettings(
  dto: UpdateAppSettingsDto,
  updatedById: string,
): Promise<AppSettings> {
  const current = await this.getAppSettings();

  const { defaultFilters, ...rest } = dto;

  return this.prisma.appSettings.update({
    where: { id: current.id },
    data: {
      ...rest,
      updatedById,
      ...(defaultFilters !== undefined && {
        defaultFilters: defaultFilters as Prisma.InputJsonValue,
      }),
    },
  });
}
  async setFeatureFlag(key: string, enabled: boolean, updatedById: string): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });

    if (!flag) {
      // Flags are seeded by migration because they are coupled to code. An unknown key is
      // a mistake, not a request to invent one.
      throw new NotFoundException('That feature flag does not exist.');
    }

    await this.prisma.featureFlag.update({ where: { key }, data: { enabled, updatedById } });
  }

  async listFeatureFlags(): Promise<
    { key: string; name: string; description: string; enabled: boolean }[]
  > {
    return this.prisma.featureFlag.findMany({
      select: { key: true, name: true, description: true, enabled: true },
      orderBy: { key: 'asc' },
    });
  }

  /** Effective settings for a caller, or the global defaults when nobody is signed in. */
  async resolveFor(userId: string | undefined): Promise<EffectiveSettings> {
    const [app, row] = await Promise.all([
      this.prisma.appSettings.findFirst(),
      userId ? this.prisma.userSettings.findUnique({ where: { userId } }) : Promise.resolve(null),
    ]);

    return resolveSettings(this.toGlobalDefaults(app), this.toOverrides(row));
  }

  private toGlobalDefaults(app: AppSettings | null): GlobalDefaults | null {
    return app
      ? {
          defaultTheme: app.defaultTheme,
          defaultLanguage: app.defaultLanguage,
          defaultSort: app.defaultSort,
          defaultFilters: app.defaultFilters,
        }
      : null;
  }

  private toOverrides(row: UserSettings | null): UserOverrides {
    return {
      theme: row?.theme ?? null,
      language: row?.language ?? null,
      defaultSort: row?.defaultSort ?? null,
      defaultFilters: row?.defaultFilters ?? null,
      notifyOnComment: row?.notifyOnComment ?? null,
    };
  }

  async getFeatureFlags(): Promise<Record<string, boolean>> {
    const flags = await this.prisma.featureFlag.findMany({
      select: { key: true, enabled: true },
      orderBy: { key: 'asc' },
    });

    return Object.fromEntries(flags.map((flag) => [flag.key, flag.enabled]));
  }
}

import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppSettings, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { UpdateAppSettingsDto, UpdateFeatureFlagDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * The full row, including fields no ordinary user ever receives: the allowed email
   * domains and the rate-limit internals. Everyone else gets only the resolved public
   * subset, through /bootstrap.
   */
  @Get('settings')
  @ApiOperation({ summary: 'Application settings' })
  get(): Promise<AppSettings> {
    return this.settings.getAppSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update application settings' })
  update(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateAppSettingsDto,
  ): Promise<AppSettings> {
    return this.settings.updateAppSettings(dto, principal.userId);
  }

  @Get('feature-flags')
  @ApiOperation({ summary: 'Feature flags with their descriptions' })
  flags(): Promise<{ key: string; name: string; description: string; enabled: boolean }[]> {
    return this.settings.listFeatureFlags();
  }

  @Patch('feature-flags/:key')
  @ApiOperation({ summary: 'Toggle a feature flag' })
  async setFlag(
    @Param('key') key: string,
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<{ key: string; enabled: boolean }> {
    await this.settings.setFeatureFlag(key, dto.enabled, principal.userId);
    return { key, enabled: dto.enabled };
  }
}

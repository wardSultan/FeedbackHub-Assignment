import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import {
  UpdateProfileDto,
  UpdateUserSettingsDto,
} from '../settings/dto/settings.dto';
import type { EffectiveSettings, UserOverrides } from '../settings/settings-resolution';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The signed-in user. Deliberately reflects the principal rather than re-reading the
   * database: if this returns the right person, the whole chain — token verification,
   * audience check, provisioning, role resolution — worked.
   */
  @Get()
  @ApiOperation({ summary: 'The currently authenticated user' })
  @ApiOkResponse({ description: 'The authenticated user.' })
  me(@CurrentUser() principal: Principal): Principal {
    return principal;
  }

  @Patch()
  @ApiOperation({ summary: 'Update your display name or avatar' })
  async updateProfile(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateProfileDto,
  ): Promise<Pick<Principal, 'userId' | 'displayName' | 'email' | 'role'>> {
    const updated = await this.users.updateProfile(principal.userId, dto);

    return {
      userId: updated.id,
      displayName: updated.displayName,
      email: updated.email,
      role: updated.role,
    };
  }

  /**
   * Returns the raw overrides *and* the effective values. The settings screen needs both
   * to distinguish "Dark, because you chose it" from "Dark, because that is the default",
   * and to offer a reset control that actually does something.
   */
  @Get('settings')
  @ApiOperation({ summary: 'Your overrides and the settings they resolve to' })
  getSettings(
    @CurrentUser() principal: Principal,
  ): Promise<{ overrides: UserOverrides; effective: EffectiveSettings }> {
    return this.settings.getUserSettings(principal.userId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Set or clear your overrides — null returns a setting to the default' })
  updateSettings(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateUserSettingsDto,
  ): Promise<{ overrides: UserOverrides; effective: EffectiveSettings }> {
    return this.settings.updateUserSettings(principal.userId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your account — content is kept and anonymised' })
  deleteAccount(@CurrentUser() principal: Principal): Promise<void> {
    return this.users.deleteOwnAccount(principal);
  }
}

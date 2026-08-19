import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_FEATURE_KEY } from './requires-feature.decorator';
import { SettingsService } from './settings.service';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!key) {
      return true;
    }

    if (!(await this.settings.isFeatureEnabled(key))) {
      throw new ForbiddenException('That feature is currently disabled.');
    }

    return true;
  }
}

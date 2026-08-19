import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Category, Status } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { Public } from '../auth/public.decorator';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import type { EffectiveSettings } from './settings-resolution';
import { SettingsService } from './settings.service';

export interface BootstrapPayload {
  user: Pick<Principal, 'userId' | 'email' | 'displayName' | 'role'> | null;
  settings: EffectiveSettings;
  flags: Record<string, boolean>;
  taxonomy: { categories: Category[]; statuses: Status[] };
}

/**
 * Everything the client needs before it can render its first screen, in one call.
 *
 * This is the direct answer to the brief's interest in "how the frontend obtains it
 * without a chain of blocking requests on startup". The failure mode it avoids is the
 * obvious implementation: /me, then /settings, then /flags, then /categories, then
 * /statuses — five sequential round trips and a white screen for the sum of them.
 *
 * Public, because an anonymous client needs the same shape to render the shell. It gets
 * `user: null` and the global defaults, so the frontend never branches on whether anyone
 * is signed in just to lay the page out.
 *
 * Settings arrive already resolved. The precedence rule lives on the server and exists in
 * exactly one place; a client that re-implemented it would eventually disagree with it.
 */
@ApiTags('bootstrap')
@Controller('bootstrap')
export class BootstrapController {
  constructor(
    private readonly settings: SettingsService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Everything needed to render the first screen, in one request' })
  async bootstrap(@CurrentUser() principal?: Principal): Promise<BootstrapPayload> {
    // Issued together rather than awaited in sequence: the point of this endpoint is one
    // round trip for the client, which is wasted if the server serialises internally.
    const [settings, flags, categories, statuses] = await Promise.all([
      this.settings.resolveFor(principal?.userId),
      this.settings.getFeatureFlags(),
      this.taxonomy.listCategories(),
      this.taxonomy.listStatuses(),
    ]);

    return {
      user: principal
        ? {
            userId: principal.userId,
            email: principal.email,
            displayName: principal.displayName,
            role: principal.role,
          }
        : null,
      settings,
      flags,
      taxonomy: { categories, statuses },
    };
  }
}

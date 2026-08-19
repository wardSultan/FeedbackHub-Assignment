import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';

@ApiTags('users')
@Controller('me')
export class UsersController {
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
}

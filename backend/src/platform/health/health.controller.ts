import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../modules/auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
// Version-neutral and outside the global prefix: probe URLs are infrastructure
// contracts and must not move when the API is versioned.
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness: the process is running. Deliberately checks nothing else — a liveness probe
   * that fails on a database outage causes the orchestrator to restart healthy pods,
   * turning a recoverable dependency failure into a crash loop.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: this instance can actually serve traffic. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async ready(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await this.prisma.ping();
    } catch {
      throw new ServiceUnavailableException('Database is not reachable.');
    }

    return { status: 'ok', database: 'up' };
  }
}

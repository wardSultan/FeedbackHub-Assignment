import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';

/**
 * The composition root.
 *
 * Domain modules are added here as they land: users, authz, taxonomy, feedback, votes,
 * comments and settings. They are separate modules with explicit interfaces — the same
 * boundaries a service split would draw — but they run in one process, because the
 * invariants they share (one vote per user, correct derived counts) are enforced by a
 * single database transaction. See docs/DECISIONS.md, ADR-0001.
 */
@Module({
  imports: [PlatformModule],
})
export class AppModule {}

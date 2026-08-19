import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { UsersModule } from './modules/users/users.module';
import { VotesModule } from './modules/votes/votes.module';
import { PlatformModule } from './platform/platform.module';

/**
 * The composition root.
 *
 * Domain modules are added here as they land: taxonomy, comments and settings. They are separate modules with explicit interfaces — the same
 * boundaries a service split would draw — but they run in one process, because the
 * invariants they share (one vote per user, correct derived counts) are enforced by a
 * single database transaction. See docs/DECISIONS.md, ADR-0001.
 */
@Module({
  imports: [PlatformModule, AuthModule, UsersModule, FeedbackModule, VotesModule],
})
export class AppModule {}

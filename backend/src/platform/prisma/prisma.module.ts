import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global because every domain module needs database access, and threading an import
 * through each of them adds ceremony without adding a boundary. The boundary that
 * matters is which module may touch which *table*, and that is a convention enforced by
 * review, not by the DI container.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Category, Status } from '@prisma/client';
import { TaxonomyService } from './taxonomy.service';

/**
 * Read side. Everyone who can see the board needs these to render filter chips and the
 * create form, so they carry no role requirement — only the writes below do.
 */
@ApiTags('taxonomy')
@Controller()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Active categories' })
  categories(): Promise<Category[]> {
    return this.taxonomy.listCategories();
  }

  @Get('statuses')
  @ApiOperation({ summary: 'Active statuses' })
  statuses(): Promise<Status[]> {
    return this.taxonomy.listStatuses();
  }
}

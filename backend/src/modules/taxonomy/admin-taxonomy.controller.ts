import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Category, Status, UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  CreateTaxonomyTermDto,
  UpdateStatusDto,
  UpdateTaxonomyTermDto,
} from './dto/taxonomy.dto';
import { TaxonomyService } from './taxonomy.service';

/**
 * "Admin" is an audience, not a bounded context, so this is a route grouping over the
 * taxonomy module rather than a module of its own. The alternative — an admin module that
 * also knows how categories work — would put the same rules in two places, differing only
 * by who may call them, which is how authorization bugs are made.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminTaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('categories')
  @ApiOperation({ summary: 'All categories, including retired ones' })
  listCategories(): Promise<Category[]> {
    return this.taxonomy.listCategories(true);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Add a category' })
  createCategory(@Body() dto: CreateTaxonomyTermDto): Promise<Category> {
    return this.taxonomy.createCategory(dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Rename, recolour, reorder, or retire a category' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxonomyTermDto,
  ): Promise<Category> {
    return this.taxonomy.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category — refused with 409 if it is still in use' })
  deleteCategory(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.taxonomy.deleteCategory(id);
  }

  @Get('statuses')
  @ApiOperation({ summary: 'All statuses, including retired ones' })
  listStatuses(): Promise<Status[]> {
    return this.taxonomy.listStatuses(true);
  }

  @Post('statuses')
  @ApiOperation({ summary: 'Add a status' })
  createStatus(@Body() dto: CreateTaxonomyTermDto): Promise<Status> {
    return this.taxonomy.createStatus(dto);
  }

  @Patch('statuses/:id')
  @ApiOperation({ summary: 'Update a status, or make it the default for new requests' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<Status> {
    return this.taxonomy.updateStatus(id, dto);
  }

  @Delete('statuses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a status — refused with 409 if it is still in use' })
  deleteStatus(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.taxonomy.deleteStatus(id);
  }
}

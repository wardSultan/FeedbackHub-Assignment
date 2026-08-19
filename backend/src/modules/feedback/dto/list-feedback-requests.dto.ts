import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const LIST_SORTS = [
  'NEWEST',
  'OLDEST',
  'MOST_VOTED',
  'MOST_COMMENTED',
  'RECENTLY_UPDATED',
] as const;

export type ListSortValue = (typeof LIST_SORTS)[number];

/** `?status=new&status=planned` and `?status=new,planned` should both work. */
const toStringArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : [value];
  const items = raw
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
};

export class ListFeedbackRequestsDto {
  @ApiPropertyOptional({ description: 'Free-text search over title and description.' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => String(value ?? '').trim() || undefined)
  q?: string;

  @ApiPropertyOptional({ description: 'Status slugs.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toStringArray)
  status?: string[];

  @ApiPropertyOptional({ description: 'Category slugs.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toStringArray)
  category?: string[];

  @ApiPropertyOptional({ description: 'Restrict to the caller’s own requests.' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  mine?: boolean;

  @ApiPropertyOptional({ enum: LIST_SORTS })
  @IsOptional()
  @IsIn(LIST_SORTS)
  sort?: ListSortValue;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Capped server-side. An uncapped page size is a one-request denial of service.
  @Max(100)
  pageSize = 20;
}

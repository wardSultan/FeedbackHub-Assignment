import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const THEMES = ['LIGHT', 'DARK', 'SYSTEM'] as const;
const SORTS = ['NEWEST', 'OLDEST', 'MOST_VOTED', 'MOST_COMMENTED', 'RECENTLY_UPDATED'] as const;
const POLICIES = ['OPEN', 'INVITE_ONLY', 'DOMAIN_RESTRICTED'] as const;

export class FilterSelectionDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  statuses?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  categories?: string[];
}

/**
 * `null` clears an override and returns the setting to the global default; omitting a
 * field leaves it untouched. class-validator's @IsOptional() lets null through, and Prisma
 * maps null to a SQL NULL and undefined to "no change", so both intentions survive all the
 * way to the column without any special handling in the service.
 */
export class UpdateUserSettingsDto {
  @ApiPropertyOptional({ enum: THEMES, nullable: true })
  @IsOptional()
  @IsIn(THEMES)
  theme?: (typeof THEMES)[number] | null;

  @ApiPropertyOptional({ nullable: true, example: 'en' })
  @IsOptional()
  @IsString()
  // Bounded so an empty string cannot be stored as an override: it would pass the
  // resolver's null check and then resolve to a locale that does not exist.
  @Length(2, 10)
  language?: string | null;

  @ApiPropertyOptional({ enum: SORTS, nullable: true })
  @IsOptional()
  @IsIn(SORTS)
  defaultSort?: (typeof SORTS)[number] | null;

  @ApiPropertyOptional({ type: FilterSelectionDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FilterSelectionDto)
  defaultFilters?: FilterSelectionDto | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  notifyOnComment?: boolean | null;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80, { message: 'Display name must be between 1 and 80 characters.' })
  displayName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  avatarUrl?: string | null;
}

/** Administrator-only. Every field is optional; only what is sent is changed. */
export class UpdateAppSettingsDto {
  @ApiPropertyOptional({ enum: POLICIES })
  @IsOptional()
  @IsIn(POLICIES)
  registrationPolicy?: (typeof POLICIES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedEmailDomains?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  commentsRequireApproval?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  submissionLimitCount?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 720 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  submissionLimitWindowHours?: number;

  @ApiPropertyOptional({ enum: THEMES })
  @IsOptional()
  @IsIn(THEMES)
  defaultTheme?: (typeof THEMES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 10)
  defaultLanguage?: string;

  @ApiPropertyOptional({ enum: SORTS })
  @IsOptional()
  @IsIn(SORTS)
  defaultSort?: (typeof SORTS)[number];

  @ApiPropertyOptional({ type: FilterSelectionDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FilterSelectionDto)
  defaultFilters?: FilterSelectionDto;
}

export class UpdateFeatureFlagDto {
  @IsBoolean()
  enabled!: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Lengths mirror the CHECK constraints in the migration. Duplicating them is deliberate:
 * the database guarantees the invariant, and the DTO turns a violation into a 400 with a
 * message pointing at the field instead of a 500 from a constraint error.
 */
export class CreateFeedbackRequestDto {
  @ApiProperty({ minLength: 5, maxLength: 120 })
  @IsString()
  @Transform(trim)
  @Length(5, 120, { message: 'Title must be between 5 and 120 characters.' })
  title!: string;

  @ApiProperty({ minLength: 10, maxLength: 5000 })
  @IsString()
  @Transform(trim)
  @Length(10, 5000, { message: 'Description must be between 10 and 5000 characters.' })
  description!: string;

  @ApiProperty({ description: 'Slug of an active category.' })
  @IsString()
  @Transform(trim)
  @Length(1, 40)
  categorySlug!: string;
}

/** Content only. Status and pinning are admin operations with their own endpoints. */
export class UpdateFeedbackRequestDto {
  @ApiPropertyOptional({ minLength: 5, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(5, 120, { message: 'Title must be between 5 and 120 characters.' })
  title?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(10, 5000, { message: 'Description must be between 10 and 5000 characters.' })
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 40)
  categorySlug?: string;
}

export class SetStatusDto {
  @ApiProperty({ description: 'Slug of an active status.' })
  @IsString()
  @Transform(trim)
  @Length(1, 40)
  statusSlug!: string;
}

export class SetPinnedDto {
  @ApiProperty()
  @IsBoolean()
  pinned!: boolean;
}

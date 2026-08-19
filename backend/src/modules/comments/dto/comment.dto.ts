import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, IsOptional } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Bounds mirror the CHECK constraint in the migration, so a violation is a 400 not a 500. */
export class WriteCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Transform(trim)
  @Length(1, 2000, { message: 'A comment must be between 1 and 2000 characters.' })
  body!: string;
}

export class ListCommentsDto {
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
  @Max(100)
  pageSize = 20;
}

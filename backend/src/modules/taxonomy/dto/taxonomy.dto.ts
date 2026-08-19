import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsHexColor, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTaxonomyTermDto {
  @ApiProperty({ minLength: 1, maxLength: 40 })
  @IsString()
  @Transform(trim)
  @Length(1, 40, { message: 'Name must be between 1 and 40 characters.' })
  name!: string;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @IsHexColor({ message: 'Colour must be a hex value such as #3b82f6.' })
  color?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateTaxonomyTermDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 40, { message: 'Name must be between 1 and 40 characters.' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor({ message: 'Colour must be a hex value such as #3b82f6.' })
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Set false to retire the term without deleting it.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStatusDto extends UpdateTaxonomyTermDto {
  @ApiPropertyOptional({ description: 'Make this the status new requests receive.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

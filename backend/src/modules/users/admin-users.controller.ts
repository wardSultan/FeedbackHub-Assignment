import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { UsersService, type AdminUserView } from './users.service';

export class ListUsersDto {
  @ApiPropertyOptional({ description: 'Match against display name or email.' })
  @IsOptional()
  @IsString()
  q?: string;

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

export class SetRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole, { message: 'Role must be either USER or ADMIN.' })
  role!: UserRole;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users' })
  list(
    @Query() query: ListUsersDto,
  ): Promise<{ items: AdminUserView[]; page: number; pageSize: number; total: number }> {
    return this.users.list(query);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Promote a user to administrator, or demote one' })
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: SetRoleDto,
  ): Promise<AdminUserView> {
    return this.users.setRole(id, principal, dto.role);
  }
}

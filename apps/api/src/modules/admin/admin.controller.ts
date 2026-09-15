import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Permission, UserRole, type Principal } from '@autoparts/core';
import { CurrentPrincipal, RequirePermissions, Roles } from '../../common/common.js';
import { AdminService, type ConflictAction } from './admin.service.js';
import { AuditService } from './audit.service.js';

class ResolveConflictDto {
  @IsIn(['approve', 'reject', 'map', 'investigate']) action!: ConflictAction;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() criteria?: Record<string, unknown>;
}

class PartnerStatusDto {
  @IsIn(['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED']) status!: string;
}

class PriceRuleDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() partnerId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsNumber() markupPercent?: number;
  @IsOptional() @IsString() markupFixedMinor?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class MarkupPreviewDto {
  @IsOptional() @IsUUID() partnerId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsNumber() markupPercent!: number;
}

class RefundDto {
  @IsOptional() @IsString() amountMinor?: string;
}

class SuspendDto {
  @IsBoolean() suspended!: boolean;
}

class DisputeDto {
  @IsUUID() orderItemId!: string;
  @IsOptional() @IsString() note?: string;
}

/**
 * Admin API (PRD §59, docs/09).
 *
 * Support can read everything and start a refund, but cannot change what the
 * platform charges; only SUPER_ADMIN hands out roles (docs/09 §9).
 */
@ApiTags('admin')
@Roles(UserRole.PLATFORM_SUPPORT, UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  /* ── the queue that matters most: unresolved, R1 hides products forever ── */

  @Get('fitment/conflicts')
  @ApiOperation({ summary: 'Open fitment conflicts, ordered by how much they block' })
  conflicts(@Query('limit') limit?: number) {
    return this.admin.conflicts(limit ? Number(limit) : 50);
  }

  @Post('fitment/conflicts/:id/resolve')
  @RequirePermissions(Permission.RESOLVE_FITMENT_CONFLICT)
  @ApiOperation({ summary: 'Approve, reject, map or keep investigating' })
  resolve(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveConflictDto,
  ) {
    return this.admin.resolveConflict(p, id, dto);
  }

  @Post('fitment/disputes')
  @ApiOperation({ summary: 'Record that a fitment decision was wrong (feeds the KPI)' })
  dispute(@CurrentPrincipal() p: Principal, @Body() dto: DisputeDto) {
    return this.admin.reportFitmentDispute(p, dto.orderItemId, dto.note);
  }

  /* ── partners ── */

  @Get('partners')
  partners(@Query('status') status?: string) {
    return this.admin.partners(status);
  }

  @Patch('partners/:id/status')
  @RequirePermissions(Permission.APPROVE_PARTNER)
  @ApiOperation({ summary: 'Approve, suspend or reject a partner' })
  setPartnerStatus(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartnerStatusDto,
  ) {
    return this.admin.setPartnerStatus(p, id, dto.status);
  }

  /* ── pricing ── */

  @Get('price-rules')
  priceRules() {
    return this.admin.priceRules();
  }

  @Post('price-rules/preview')
  @RequirePermissions(Permission.MANAGE_MARKUP)
  @ApiOperation({ summary: 'How many offers a markup change would move, and by how much' })
  preview(@Body() dto: MarkupPreviewDto) {
    return this.admin.previewMarkup(dto);
  }

  @Post('price-rules')
  @RequirePermissions(Permission.MANAGE_MARKUP)
  @ApiOperation({ summary: 'Create or update a markup rule' })
  upsertRule(@CurrentPrincipal() p: Principal, @Body() dto: PriceRuleDto) {
    return this.admin.upsertPriceRule(p, dto);
  }

  /* ── orders and money ── */

  @Get('orders')
  orders(
    @Query('status') status?: string,
    @Query('partnerId') partnerId?: string,
    @Query('limit') limit?: number,
  ) {
    return this.admin.orders({
      ...(status ? { status } : {}),
      ...(partnerId ? { partnerId } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Post('orders/:id/refund')
  @RequirePermissions(Permission.ISSUE_REFUND)
  @ApiOperation({ summary: 'Refund fully or in part' })
  refund(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDto,
  ) {
    return this.admin.refundOrder(p, id, dto.amountMinor);
  }

  /* ── users ── */

  @Get('users')
  users(@Query('search') search?: string, @Query('limit') limit?: number) {
    return this.admin.users({
      ...(search ? { search } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Patch('users/:id/suspension')
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
  suspend(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDto,
  ) {
    return this.admin.setUserSuspended(p, id, dto.suspended);
  }

  /* ── analytics and audit ── */

  @Get('analytics')
  @ApiOperation({ summary: 'Funnel and KPIs, accuracy first' })
  analytics() {
    return this.admin.analytics();
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Append-only record of who changed what' })
  auditLogs(
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: number,
  ) {
    return this.audit.list({
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Post('search/reindex')
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
  reindex(@CurrentPrincipal() p: Principal) {
    return this.admin.reindexSearch(p);
  }
}

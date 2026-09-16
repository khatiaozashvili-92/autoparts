import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { Permission, UserRole, type Principal } from '@autoparts/core';
import { CurrentPrincipal, RequirePermissions, Roles } from '../../common/common.js';
import { AdminService, type ConflictAction } from './admin.service.js';
import { AuditService } from './audit.service.js';
import { CatalogueAdminService } from './catalogue-admin.service.js';
import { PartnerAdminService } from './partner-admin.service.js';

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

class CreatePartnerDto {
  @IsString() @Length(2, 200) legalName!: string;
  @IsString() @Length(2, 200) displayName!: string;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @IsOptional() @IsString() @MaxLength(200) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  /** The first person who can sign in to the new portal. */
  @IsString() @MaxLength(20) adminPhone!: string;
  @IsOptional() @IsString() @Length(1, 80) adminFirstName?: string;
}

class PartnerUserDto {
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @Length(1, 80) firstName?: string;
  @IsOptional() @IsIn(['PARTNER_USER', 'PARTNER_ADMIN']) role?: 'PARTNER_USER' | 'PARTNER_ADMIN';
}

class CategoryDto {
  @IsString() @Length(2, 60) slug!: string;
  @IsString() @Length(1, 120) nameKa!: string;
  @IsString() @Length(1, 120) nameEn!: string;
  @IsOptional() @IsArray() synonymsKa?: string[];
  @IsOptional() @IsArray() synonymsEn?: string[];
  @IsOptional() @IsArray() requiredVehicleAttributes?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
}

class CategoryUpdateDto {
  @IsOptional() @IsString() @Length(1, 120) nameKa?: string;
  @IsOptional() @IsString() @Length(1, 120) nameEn?: string;
  @IsOptional() @IsArray() synonymsKa?: string[];
  @IsOptional() @IsArray() synonymsEn?: string[];
  @IsOptional() @IsArray() requiredVehicleAttributes?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ProductReviewDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() note?: string;
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
    private readonly partnerAdmin: PartnerAdminService,
    private readonly catalogue: CatalogueAdminService,
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

  /**
   * Creates a partner company and the account that will run it.
   *
   * SUPER_ADMIN only, and there is no self-registration route anywhere: a
   * partner is a signed commercial relationship, so admitting one is a
   * deliberate act by a named person (docs/09 §4).
   */
  @Post('partners')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a partner company and its first administrator' })
  createPartner(@CurrentPrincipal() p: Principal, @Body() dto: CreatePartnerDto) {
    return this.partnerAdmin.createPartner(p, dto);
  }

  /** Archives, never deletes: orders and audit rows reference the company. */
  @Delete('partners/:id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Retire a partner, taking its offers off the marketplace' })
  archivePartner(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.partnerAdmin.archivePartner(p, id);
  }

  @Get('partners/:id/users')
  @ApiOperation({ summary: 'Who can act for this partner' })
  partnerUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.partnerAdmin.partnerUsers(id);
  }

  @Post('partners/:id/users')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Give a phone number access to this partner portal' })
  addPartnerUser(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartnerUserDto,
  ) {
    return this.partnerAdmin.addPartnerUser(p, id, dto);
  }

  @Delete('partners/:id/users/:userId')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Revoke one person without touching the company' })
  removePartnerUser(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.partnerAdmin.removePartnerUser(p, id, userId);
  }

  /* ── categories ── */

  @Get('categories')
  @ApiOperation({ summary: 'Every category, with how much is filed under it' })
  categories() {
    return this.catalogue.categories();
  }

  @Post('categories')
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Add a category' })
  createCategory(@CurrentPrincipal() p: Principal, @Body() dto: CategoryDto) {
    return this.catalogue.createCategory(p, dto);
  }

  @Patch('categories/:id')
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Rename, reorder, retire, or change required attributes' })
  updateCategory(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CategoryUpdateDto,
  ) {
    return this.catalogue.updateCategory(p, id, dto);
  }

  /* ── inventory across every partner ── */

  /**
   * Read-only on purpose. Staff need to see what the marketplace actually
   * has; a price belongs to the partner who set it, and an admin quietly
   * editing one would leave them selling at a number they never agreed to.
   */
  @Get('inventory')
  @ApiOperation({ summary: 'Stock across every partner, worst first' })
  inventory(
    @Query('stale') stale?: string,
    @Query('search') search?: string,
  ) {
    return this.catalogue.inventory({
      stale: stale === undefined ? undefined : stale === 'true',
      search: search || undefined,
    });
  }

  @Get('inventory/summary')
  @ApiOperation({ summary: 'How much stock is stale, out, or waiting on review' })
  inventorySummary() {
    return this.catalogue.inventorySummary();
  }
  /* ── the partner-product review queue ── */

  @Get('products/pending')
  @ApiOperation({ summary: 'Products partners added that nobody has cleared for sale' })
  pendingProducts() {
    return this.catalogue.pendingProducts();
  }

  @Post('products/:id/review')
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Clear a partner product for sale, or refuse it' })
  reviewProduct(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductReviewDto,
  ) {
    return this.catalogue.reviewProduct(p, id, dto.decision, dto.note);
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

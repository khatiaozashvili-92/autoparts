import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole, errors, type Principal } from '@autoparts/core';
import { CurrentPrincipal, Public, Roles } from '../../common/common.js';
import { PartnersService } from './partners.service.js';
import { PartnerInventoryService } from './partner-inventory.service.js';
import { PartnerCatalogueService } from './partner-catalogue.service.js';
import { PartnerActiveGuard } from './partner-active.guard.js';
import { PickupService } from '../orders/pickup.service.js';

class UpdateOfferDto {
  @IsOptional() @IsString() basePriceMinor?: string;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @IsOptional() @IsIn(['IN_STOCK', 'AVAILABLE_TO_ORDER', 'UNAVAILABLE']) availabilityStatus?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class AddLocationDto {
  @IsString() @Length(1, 80) name!: string;
  @IsString() @Length(1, 200) addressLine!: string;
  @IsString() @Length(1, 80) city!: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() pickupInstructions?: string;
}

class VerifyPickupDto {
  @IsString() @Length(4, 12) code!: string;
}

class OfferQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsInt() limit?: number;
}

class ProductIdentifierDto {
  @IsIn(['OEM', 'MPN', 'EAN']) kind!: 'OEM' | 'MPN' | 'EAN';
  @IsString() @Length(2, 60) value!: string;
}

class CreateProductDto {
  @IsString() @Length(1, 60) categorySlug!: string;
  @IsString() @Length(2, 120) partName!: string;
  @IsString() @Length(1, 120) brandName!: string;
  @IsString() @Length(2, 200) productName!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProductIdentifierDto)
  identifiers!: ProductIdentifierDto[];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  /** Minor units, as a string: a price is money, and money is never a float. */
  @IsString() priceMinor!: string;
  @IsInt() @Min(0) stockQuantity!: number;
  @IsOptional() @IsString() @Length(1, 80) partnerSku?: string;
  @IsOptional() @IsUUID() locationId?: string;
}

class SalesReportQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

class ProductListQuery {
  @IsOptional() @IsBoolean() pending?: boolean;
}

@ApiTags('partner')
@Roles(UserRole.PARTNER_USER, UserRole.PARTNER_ADMIN)
// Re-reads the company on every request, so archiving one stops it trading at
// once rather than whenever its fifteen-minute token happens to expire.
@UseGuards(PartnerActiveGuard)
@Controller('partner')
export class PartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly catalogue: PartnerCatalogueService,
    private readonly inventory: PartnerInventoryService,
    private readonly pickup: PickupService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'The signed-in partner' })
  profile(@CurrentPrincipal() p: Principal) {
    return this.partners.profile(this.partners.scopeOf(p));
  }

  @Get('onboarding')
  @ApiOperation({ summary: 'What still blocks this partner from going live' })
  onboarding(@CurrentPrincipal() p: Principal) {
    return this.partners.onboarding(this.partners.scopeOf(p));
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Order counts, revenue and stock freshness' })
  dashboard(@CurrentPrincipal() p: Principal) {
    return this.partners.dashboard(this.partners.scopeOf(p));
  }

  @Get('offers')
  @ApiOperation({ summary: "This partner's offers" })
  offers(@CurrentPrincipal() p: Principal, @Query() query: OfferQuery) {
    return this.partners.offers(this.partners.scopeOf(p), query);
  }

  @Patch('offers/:id')
  @ApiOperation({ summary: 'Change price, stock or availability' })
  updateOffer(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.partners.updateOffer(this.partners.scopeOf(p), id, dto);
  }

  /* ── the catalogue this partner sells ── */

  @Get('products')
  @ApiOperation({ summary: "Everything this partner sells, listed and pending alike" })
  products(@CurrentPrincipal() p: Principal, @Query() query: ProductListQuery) {
    return this.catalogue.products(p, query);
  }

  /**
   * Adds a part the platform does not list yet.
   *
   * It is created inert and goes to the admin review queue: a product with no
   * fitment data cannot be matched to a car, so listing it would break the one
   * promise the product makes (docs/05 §1).
   */
  @Post('products')
  @Roles(UserRole.PARTNER_ADMIN)
  @ApiOperation({ summary: 'Add a product with its price and stock' })
  createProduct(@CurrentPrincipal() p: Principal, @Body() dto: CreateProductDto) {
    return this.catalogue.createProduct(p, dto);
  }

  @Get('reports/sales')
  @ApiOperation({ summary: 'Units, revenue and best sellers over a date range' })
  salesReport(@CurrentPrincipal() p: Principal, @Query() query: SalesReportQuery) {
    return this.catalogue.salesReport(p, query);
  }

  @Get('locations')
  locations(@CurrentPrincipal() p: Principal) {
    return this.partners.locations(this.partners.scopeOf(p));
  }

  @Post('locations')
  @ApiOperation({ summary: 'Add a pickup location' })
  addLocation(@CurrentPrincipal() p: Principal, @Body() dto: AddLocationDto) {
    return this.partners.addLocation(this.partners.scopeOf(p), dto);
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'Fitment conflicts currently hiding this partner’s products' })
  conflicts(@CurrentPrincipal() p: Principal) {
    return this.partners.conflicts(this.partners.scopeOf(p));
  }

  /* ─────────────────────── orders ─────────────────────── */

  @Get('orders')
  @ApiOperation({ summary: 'The order queue for this partner' })
  orders(@CurrentPrincipal() p: Principal, @Query('status') status?: string) {
    return this.pickup.partnerOrders(this.partners.scopeOf(p), status);
  }

  @Post('orders/:id/ready')
  @ApiOperation({ summary: 'Mark ready for pickup, starting the 24-hour clock' })
  markReady(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pickup.markReady(this.partners.scopeOf(p), id);
  }

  @Post('orders/:id/verify-pickup')
  @ApiOperation({ summary: 'Verify the code the customer presented' })
  verifyPickup(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyPickupDto,
  ) {
    return this.pickup.verify(this.partners.scopeOf(p), id, dto.code);
  }

  /* ─────────────────────── inventory ─────────────────────── */

  @Post('inventory/csv')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a CSV/TSV price and stock file' })
  async uploadCsv(
    @CurrentPrincipal() p: Principal,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw errors.validation({ field: 'file', reason: 'no file uploaded' });
    const partnerId = this.partners.scopeOf(p);
    const rows = this.inventory.parseCsv(file.buffer);
    return this.inventory.importRows(partnerId, rows, 'CSV', file.originalname);
  }

  @Get('inventory/syncs')
  syncs(@CurrentPrincipal() p: Principal) {
    return this.inventory.syncHistory(this.partners.scopeOf(p));
  }

  @Get('inventory/syncs/:id')
  @ApiOperation({ summary: 'One sync with its row-level errors' })
  async sync(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.inventory.syncDetail(this.partners.scopeOf(p), id);
    if (!row) throw errors.notFound('Sync');
    return row;
  }

  /**
   * A downloadable template with the right headers and two example rows.
   *
   * Public because it is the cheapest possible support channel: most import
   * failures are a wrong header, and a correct file to start from prevents
   * them (docs/06 §5).
   */
  @Public()
  @Get('inventory/template.csv')
  @ApiOperation({ summary: 'CSV template with example rows' })
  template(@Res() res: Response): void {
    const csv = [
      'sku,oem,mpn,name,brand,price,currency,quantity,availability,warranty_months',
      'BP-2211,34116850568,BOS12345,Front Brake Pads,Bosch,420.50,GEL,5,in_stock,24',
      'OF-1007,11427566327,MAN55011,Oil Filter,Mann-Filter,28.00,GEL,0,available_to_order,12',
    ].join('\n');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="autoparts-inventory-template.csv"');
    res.send(csv);
  }
}

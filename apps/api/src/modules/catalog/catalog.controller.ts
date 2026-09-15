import { Controller, Get, Headers, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { errors } from '@autoparts/core';
import { Public } from '../../common/common.js';
import { CatalogService } from './catalog.service.js';

class VehicleQuery {
  @IsOptional() @IsUUID() vehicleId?: string;
}

/** `Accept-Language` drives copy; nothing user-visible is hardcoded (PRD §80). */
function localeOf(header?: string): string {
  const first = header?.split(',')[0]?.split('-')[0]?.trim().toLowerCase();
  return first === 'en' ? 'en' : 'ka';
}

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Category tree in the requested locale' })
  categories(@Headers('accept-language') lang?: string) {
    return this.catalog.categories(localeOf(lang));
  }

  @Public()
  @Get('categories/:slug/parts')
  @ApiQuery({ name: 'vehicleId', required: false })
  @ApiOperation({ summary: 'Master parts in a category, optionally scored for a vehicle' })
  parts(
    @Param('slug') slug: string,
    @Query() query: VehicleQuery,
    @Headers('accept-language') lang?: string,
  ) {
    return this.catalog.partsInCategory(slug, localeOf(lang), query.vehicleId);
  }

  @Public()
  @Get('brands')
  @ApiOperation({ summary: 'All brands, OEM first' })
  brands() {
    return this.catalog.brands();
  }

  @Public()
  @Get('products/:id')
  @ApiQuery({ name: 'vehicleId', required: false })
  @ApiOperation({ summary: 'Product detail, with a fitment verdict when a vehicle is given' })
  product(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VehicleQuery,
    @Headers('accept-language') lang?: string,
  ) {
    return this.catalog.product(id, localeOf(lang), query.vehicleId);
  }

  @Get('master-parts/:id/products')
  @ApiOperation({ summary: 'Products for a master part that fit the given vehicle' })
  productsForPart(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VehicleQuery,
    @Headers('accept-language') lang?: string,
  ) {
    // Without a vehicle there is no fitment to check, and showing an unchecked
    // list would be the one thing R1 forbids.
    if (!query.vehicleId) throw errors.vehicleRequired();
    return this.catalog.productsForPart(id, query.vehicleId, localeOf(lang));
  }
}

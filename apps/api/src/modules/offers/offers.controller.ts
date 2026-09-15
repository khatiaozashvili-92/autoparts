import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Public } from '../../common/common.js';
import { OffersService, type OfferSort } from './offers.service.js';

class OfferQuery {
  @IsUUID() productId!: string;
  // Required: an offer list is one click from a purchase, so it may never be
  // shown without knowing which car it is for (R1).
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsIn(['recommended', 'cheapest', 'nearest', 'best_rated', 'fastest'])
  sort?: OfferSort;
  @IsOptional() @IsIn(['IN_STOCK', 'AVAILABLE_TO_ORDER', 'BOTH'])
  availability?: 'IN_STOCK' | 'AVAILABLE_TO_ORDER' | 'BOTH';
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lon?: number;
  @IsOptional() @IsInt() limit?: number;
}

@ApiTags('offers')
@Controller()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Public()
  @Get('offers')
  @ApiOperation({ summary: 'Partner offers for a product, for a specific vehicle' })
  async list(@Query() query: OfferQuery) {
    const result = await this.offers.forProduct({
      productId: query.productId,
      vehicleId: query.vehicleId,
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.availability ? { availability: query.availability } : {}),
      ...(query.lat !== undefined ? { lat: query.lat } : {}),
      ...(query.lon !== undefined ? { lon: query.lon } : {}),
    });

    return {
      data: result.offers.slice(0, query.limit ?? 50),
      // The client needs to distinguish "nobody stocks it" from "it does not fit
      // your car" — the next step the user is offered differs.
      ...(result.fitmentBlocked ? { emptyReason: 'NOT_COMPATIBLE' as const } : {}),
    };
  }
}

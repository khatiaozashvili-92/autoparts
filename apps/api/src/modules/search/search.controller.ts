import { Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { UserRole } from '@autoparts/core';
import { Public, Roles } from '../../common/common.js';
import { SearchService } from './search.service.js';

class SearchQuery {
  @IsString() @Length(1, 120) q!: string;
  // Required, not optional: searching for a part without saying which car is
  // exactly the mistake this product exists to prevent (PRD §14).
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsIn(['IN_STOCK', 'AVAILABLE_TO_ORDER', 'BOTH']) availability?: 'IN_STOCK' | 'AVAILABLE_TO_ORDER' | 'BOTH';
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}

function localeOf(header?: string): string {
  const first = header?.split(',')[0]?.split('-')[0]?.trim().toLowerCase();
  return first === 'en' ? 'en' : 'ka';
}

@ApiTags('search')
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('search')
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'vehicleId', required: true })
  @ApiOperation({ summary: 'Search parts for a specific vehicle' })
  find(@Query() query: SearchQuery, @Headers('accept-language') lang?: string) {
    return this.search.search({
      query: query.q,
      vehicleId: query.vehicleId,
      locale: localeOf(lang),
      ...(query.availability ? { availability: query.availability } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
  }

  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/search/reindex')
  @ApiOperation({ summary: 'Rebuild the search index from the catalogue' })
  async reindex() {
    return { documents: await this.search.reindex() };
  }
}

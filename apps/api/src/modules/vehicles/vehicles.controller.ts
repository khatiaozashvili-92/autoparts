import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Principal } from '@autoparts/core';
import { CurrentPrincipal, Public } from '../../common/common.js';
import { VinService } from './vin.service.js';
import { VehiclesService } from './vehicles.service.js';

class DecodeVinDto {
  @IsString() @Length(11, 25) vin!: string;
}

class AddVehicleDto {
  @IsUUID() configurationId!: string;
  @IsOptional() @IsString() @Length(1, 60) customName?: string;
  @IsOptional() @IsObject() clarificationAnswers?: Record<string, string>;
}

class UpdateVehicleDto {
  @IsOptional() @IsString() @Length(1, 60) customName?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsObject() clarificationAnswers?: Record<string, string>;
}

@ApiTags('vehicles')
@Controller()
export class VehiclesController {
  constructor(
    private readonly vin: VinService,
    private readonly vehicles: VehiclesService,
  ) {}

  /**
   * Public so the decode can be shown before sign-up — a first-time visitor
   * should see their car identified before being asked to create an account.
   * Rate limited because a provider lookup can cost money (docs/04 §10).
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('vin/decode')
  @HttpCode(200)
  @ApiOperation({ summary: 'Identify a vehicle from a VIN' })
  decode(@Body() dto: DecodeVinDto) {
    return this.vin.decode(dto.vin);
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'My Garage' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.vehicles.list(principal);
  }

  @Get('vehicles/:id')
  @ApiOperation({ summary: 'One vehicle from the garage' })
  get(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(principal, id);
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Add a decoded vehicle to the garage' })
  add(@CurrentPrincipal() principal: Principal, @Body() dto: AddVehicleDto) {
    return this.vehicles.add(principal, dto);
  }

  @Patch('vehicles/:id')
  @ApiOperation({ summary: 'Rename, set as default, or answer clarifications' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.update(principal, id, dto);
  }

  @Delete('vehicles/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a vehicle from the garage' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.vehicles.remove(principal, id);
  }
}

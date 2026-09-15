import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';
import { PartnerInventoryService } from './partner-inventory.service.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [PricingModule, OrdersModule],
  controllers: [PartnersController],
  providers: [PartnersService, PartnerInventoryService],
  exports: [PartnersService, PartnerInventoryService],
})
export class PartnersModule {}

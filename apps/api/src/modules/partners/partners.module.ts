import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';
import { PartnerInventoryService } from './partner-inventory.service.js';
import { PartnerCatalogueService } from './partner-catalogue.service.js';
import { PartnerActiveGuard } from './partner-active.guard.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [PricingModule, OrdersModule],
  controllers: [PartnersController],
  providers: [PartnersService, PartnerInventoryService, PartnerCatalogueService, PartnerActiveGuard],
  exports: [PartnersService, PartnerInventoryService, PartnerCatalogueService],
})
export class PartnersModule {}

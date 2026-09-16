import { Global, Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AuditService } from './audit.service.js';
import { CatalogueAdminService } from './catalogue-admin.service.js';
import { PartnerAdminService } from './partner-admin.service.js';
import { SearchModule } from '../search/search.module.js';
import { OrdersModule } from '../orders/orders.module.js';

/**
 * AuditService is global because price, stock, fitment and order changes are
 * logged wherever they happen — not only from an admin screen (PRD §79).
 */
@Global()
@Module({
  imports: [SearchModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminService, AuditService, PartnerAdminService, CatalogueAdminService],
  exports: [AuditService],
})
export class AdminModule {}

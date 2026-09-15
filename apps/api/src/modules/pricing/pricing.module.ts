import { Global, Module } from '@nestjs/common';
import { PricingService } from './pricing.service.js';

// Global: pricing is needed wherever money appears — partner imports, offers,
// checkout and the admin markup editor.
@Global()
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}

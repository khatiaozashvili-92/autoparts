import { Global, Module } from '@nestjs/common';
import { FitmentService } from './fitment.service.js';

// Global: search, catalogue, cart and the admin panel all need the same engine,
// and threading it through every module's imports adds noise without adding
// isolation.
@Global()
@Module({
  providers: [FitmentService],
  exports: [FitmentService],
})
export class FitmentModule {}

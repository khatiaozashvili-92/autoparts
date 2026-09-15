import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';
import { VinService } from './vin.service.js';
import { VinCryptoService } from './vin-crypto.service.js';
import { fitmentChainProvider } from './providers.provider.js';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VinService, VinCryptoService, fitmentChainProvider],
  exports: [VehiclesService, VinCryptoService],
})
export class VehiclesModule {}

import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [OrdersModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}

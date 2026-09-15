import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { CartService } from './cart.service.js';
import { ReservationService } from './reservation.service.js';
import { paymentProviderFactory } from './payment.provider.js';
import { PickupService } from './pickup.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, CartService, ReservationService, PickupService, paymentProviderFactory],
  exports: [OrdersService, CartService, ReservationService, PickupService],
})
export class OrdersModule {}

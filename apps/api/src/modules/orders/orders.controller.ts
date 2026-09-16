import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min, IsString, IsArray } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Principal } from '@autoparts/core';
import { CurrentPrincipal } from '../../common/common.js';
import { CartService } from './cart.service.js';
import { OrdersService } from './orders.service.js';
import { PickupService } from './pickup.service.js';
import { TransactionsService } from './transactions.service.js';

class AddCartItemDto {
  @IsUUID() offerId!: string;
  @IsUUID() vehicleId!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
}

class UpdateCartItemDto {
  @IsInt() @Min(0) @Max(99) quantity!: number;
}

class ConfirmDto {
  @IsArray() @IsUUID('4', { each: true }) reservationIds!: string[];
  @IsOptional() @IsString() idempotencyKey?: string;
}

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
    private readonly pickup: PickupService,
    private readonly transactions: TransactionsService,
  ) {}

  @Get('cart')
  getCart(@CurrentPrincipal() p: Principal) {
    return this.cart.get(p);
  }

  @Post('cart/items')
  @ApiOperation({ summary: 'Add an offer to the cart (re-checks fitment)' })
  addItem(@CurrentPrincipal() p: Principal, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(p, dto);
  }

  @Patch('cart/items/:id')
  updateItem(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(p, id, dto.quantity);
  }

  @Delete('cart/items/:id')
  removeItem(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.cart.removeItem(p, id);
  }

  @Post('checkout/reserve')
  @HttpCode(201)
  @ApiOperation({ summary: 'Hold stock for 15 minutes and quote the totals' })
  reserve(@CurrentPrincipal() p: Principal) {
    return this.orders.reserve(p);
  }

  @Post('checkout/confirm')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Create the order and start the payment' })
  confirm(
    @CurrentPrincipal() p: Principal,
    @Body() dto: ConfirmDto,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    // Retries are normal on a mobile network, and a duplicate order is real
    // money — so a key is always used, generated here only as a last resort.
    return this.orders.confirm(p, {
      reservationIds: dto.reservationIds,
      idempotencyKey: headerKey ?? dto.idempotencyKey ?? randomUUID(),
    });
  }

  @Post('orders/:id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Capture the payment after a final stock check' })
  capture(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.capture(p, id);
  }

  /**
   * What this customer paid, and what came back.
   *
   * Scoped from the token, never from a parameter: a customer id in a query
   * string would let anyone read another persons money.
   */
  @Get('transactions')
  @ApiOperation({ summary: 'Payments and refunds for the signed-in customer' })
  async transactionHistory(
    @CurrentPrincipal() p: Principal,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const scope = this.transactions.scopeFor(p, false);
    const [rows, summary] = await Promise.all([
      this.transactions.list(scope, { from, to }),
      this.transactions.summary(scope, { from, to }),
    ]);
    return { summary, data: rows };
  }

  @Get('orders')
  list(@CurrentPrincipal() p: Principal) {
    return this.orders.list(p);
  }

  @Get('orders/:id')
  detail(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(p, id);
  }

  @Get('orders/:id/pickup-code')
  @ApiOperation({ summary: 'The code to show at the counter (PRD 49)' })
  pickupCode(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pickup.credential(p, id);
  }

  @Post('orders/:id/confirm-receipt')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer confirms receipt, which completes the order' })
  confirmReceipt(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pickup.confirmReceipt(p, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel while still allowed, with an automatic refund' })
  cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(p, id);
  }
}

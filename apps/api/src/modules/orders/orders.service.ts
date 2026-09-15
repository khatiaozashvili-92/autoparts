import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  AppError,
  ErrorCode,
  OrderStatus,
  canCustomerCancel,
  errors,
  isSellable,
  type Principal,
} from '@autoparts/core';
import type { PaymentProvider } from '@autoparts/providers';
import { DatabaseService } from '../../database/database.module.js';
import { FitmentService } from '../fitment/fitment.service.js';
import { CartService } from './cart.service.js';
import { ReservationService } from './reservation.service.js';
import { PAYMENT_PROVIDER } from './payment.provider.js';
import type { AppConfig } from '../../config/configuration.js';

export interface CheckoutQuote {
  reservationIds: string[];
  expiresAt: string;
  totals: { subtotalMinor: string; markupMinor: string; totalMinor: string; currency: string };
  partner: { id: string; displayName: string };
  pickupLocation: { id: string | null; name: string | null; address: string | null };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger('OrdersService');
  private readonly pickupDeadlineHours: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly cart: CartService,
    private readonly reservations: ReservationService,
    private readonly fitment: FitmentService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    config: ConfigService<AppConfig, true>,
  ) {
    this.pickupDeadlineHours = config.get('PICKUP_DEADLINE_HOURS', { infer: true });
  }

  /**
   * Step 1 of checkout: hold the stock.
   *
   * Reserving before payment rather than after is PRD §29's first option, and
   * it is the one that fails in front of the customer instead of behind them:
   * a sold-out part is an error on the offer page, not a refund three minutes
   * after their card was charged.
   */
  async reserve(principal: Principal): Promise<CheckoutQuote> {
    const cart = await this.cart.get(principal);

    if (cart.blocker === 'EMPTY') {
      throw errors.validation({ reason: 'cart is empty' });
    }
    if (cart.blocker === 'MULTIPLE_PARTNERS') {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: 'One checkout covers one partner in this version.',
        messageKey: 'error.cart.multiplePartners',
        details: { partnerIds: cart.partnerIds },
      });
    }

    const partnerId = cart.partnerIds[0]!;

    // Real-time stock check before holding anything (R2, PRD §29). The cached
    // figure got the customer here; it does not get them past this point.
    for (const item of cart.items) {
      await this.verifyStock(item.offerId, item.quantity);
    }

    const reservationIds: string[] = [];
    let expiresAt = '';
    try {
      for (const item of cart.items) {
        const reservation = await this.reservations.reserve({
          offerId: item.offerId,
          userId: principal.userId,
          quantity: item.quantity,
        });
        reservationIds.push(reservation.id);
        expiresAt = reservation.expiresAt;
      }
    } catch (error) {
      // Partial holds would silently remove stock nobody is buying.
      await this.reservations.release(reservationIds);
      throw error;
    }

    const totals = await this.totalsFor(cart.items);
    const [location] = await this.db.query<{
      id: string; name: string; address_line: string;
    }>(
      `SELECT l.id, l.name, l.address_line
       FROM offers o
       JOIN partner_locations l ON l.id = o.location_id
       WHERE o.id = $1`,
      [cart.items[0]!.offerId],
    );

    const [partner] = await this.db.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM partners WHERE id = $1`,
      [partnerId],
    );

    return {
      reservationIds,
      expiresAt,
      totals,
      partner: { id: partner!.id, displayName: partner!.display_name },
      pickupLocation: {
        id: location?.id ?? null,
        name: location?.name ?? null,
        address: location?.address_line ?? null,
      },
    };
  }

  /**
   * Step 2: create the order and start the payment.
   *
   * Everything up to the payment intent happens in one transaction, so a
   * failure here cannot leave an order without items or items without an order.
   */
  async confirm(
    principal: Principal,
    input: { reservationIds: string[]; idempotencyKey: string },
  ): Promise<{ orderId: string; orderNumber: string; payment: { transactionId: string; status: string; redirectUrl?: string } }> {
    await this.reservations.assertActive(input.reservationIds);

    const existing = await this.db.query<{ order_id: string; order_number: string; provider_transaction_id: string | null; status: string }>(
      `SELECT p.order_id, o.order_number, p.provider_transaction_id, p.status
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing[0]) {
      // Replaying the same key returns the same answer rather than charging
      // twice — mobile networks retry, and a double order is real money.
      return {
        orderId: existing[0].order_id,
        orderNumber: existing[0].order_number,
        payment: {
          transactionId: existing[0].provider_transaction_id ?? '',
          status: existing[0].status,
        },
      };
    }

    const cart = await this.cart.get(principal);
    if (cart.items.length === 0) throw errors.validation({ reason: 'cart is empty' });

    const partnerId = cart.partnerIds[0]!;
    const totals = await this.totalsFor(cart.items);

    const client = await this.db.raw.connect();
    let orderId: string;
    let orderNumber: string;

    try {
      await client.query('BEGIN');

      orderNumber = `AP-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString('hex').toUpperCase()}`;

      const { rows: orderRows } = await client.query<{ id: string }>(
        `INSERT INTO orders (order_number, user_id, vehicle_id, status, delivery_method,
                             subtotal_minor, markup_minor, total_minor, currency,
                             payment_status, cancellation_deadline)
         VALUES ($1,$2,$3,'STOCK_RESERVED','PICKUP',$4,$5,$6,$7,'PENDING', now() + interval '24 hours')
         RETURNING id`,
        [
          orderNumber,
          principal.userId,
          cart.items[0]!.vehicleId,
          totals.subtotalMinor,
          totals.markupMinor,
          totals.totalMinor,
          totals.currency,
        ],
      );
      orderId = orderRows[0]!.id;

      const locationRows = (
        await client.query<{ location_id: string | null }>(
          `SELECT location_id FROM offers WHERE id = $1`,
          [cart.items[0]!.offerId],
        )
      ).rows;
      const locationId = locationRows[0]?.location_id ?? null;

      const { rows: partnerOrderRows } = await client.query<{ id: string }>(
        `INSERT INTO partner_orders (order_id, partner_id, location_id, status,
                                     subtotal_minor, markup_minor, total_minor, currency)
         VALUES ($1,$2,$3,'CONFIRMED',$4,$5,$6,$7)
         RETURNING id`,
        [
          orderId, partnerId, locationId,
          totals.subtotalMinor, totals.markupMinor, totals.totalMinor, totals.currency,
        ],
      );
      const partnerOrderId = partnerOrderRows[0]!.id;

      for (const item of cart.items) {
        const [offer] = (
          await client.query<{ base_price_minor: string; platform_markup_minor: string }>(
            `SELECT base_price_minor::text, platform_markup_minor::text FROM offers WHERE id = $1`,
            [item.offerId],
          )
        ).rows;

        const verdict = await this.fitment.evaluateOne(item.vehicleId, item.productId);
        if (!verdict || !isSellable(verdict.verdict)) {
          throw errors.fitmentNotConfirmed({ productId: item.productId, verdict: verdict?.verdict });
        }

        await client.query(
          `INSERT INTO order_items
             (order_id, partner_order_id, offer_id, product_id, vehicle_id, quantity,
              base_price_minor, markup_minor, line_total_minor, currency,
              fitment_verdict, product_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::fitment_verdict,$12)`,
          [
            orderId, partnerOrderId, item.offerId, item.productId, item.vehicleId, item.quantity,
            offer!.base_price_minor,
            offer!.platform_markup_minor,
            (BigInt(item.unitPriceMinor) * BigInt(item.quantity)).toString(),
            item.currency,
            verdict.verdict,
            // Frozen at purchase: the partner may rename or reprice tomorrow,
            // and the receipt must still show what was bought.
            JSON.stringify({
              name: item.productName,
              brand: item.brandName,
              unitPriceMinor: item.unitPriceMinor,
            }),
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const intent = await this.payments.createIntent({
      orderId,
      orderNumber,
      amount: { amountMinor: BigInt(totals.totalMinor), currency: totals.currency },
      commission: { amountMinor: BigInt(totals.markupMinor), currency: totals.currency },
      partnerId,
      customerId: principal.userId,
      idempotencyKey: input.idempotencyKey,
    });

    await this.db.query(
      `INSERT INTO payments (order_id, customer_id, provider, provider_transaction_id,
                             idempotency_key, amount_minor, commission_minor, currency,
                             status, authorized_at, raw_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::payment_status,
               CASE WHEN $9 = 'AUTHORIZED' THEN now() END, $10)`,
      [
        orderId, principal.userId, intent.provider, intent.transactionId,
        input.idempotencyKey, totals.totalMinor, totals.markupMinor, totals.currency,
        intent.status === 'FAILED' ? 'FAILED' : 'AUTHORIZED',
        JSON.stringify(intent.raw),
      ],
    );

    if (intent.status === 'FAILED') {
      await this.failOrder(orderId, input.reservationIds, 'payment_declined');
      throw new AppError({
        code: ErrorCode.PAYMENT_FAILED,
        status: 402,
        message: 'The payment was declined.',
        messageKey: 'error.payment.declined',
      });
    }

    await this.db.query(
      `UPDATE orders SET status = 'AWAITING_PAYMENT', updated_at = now() WHERE id = $1`,
      [orderId],
    );

    return {
      orderId,
      orderNumber,
      payment: {
        transactionId: intent.transactionId,
        status: intent.status,
        ...(intent.redirectUrl ? { redirectUrl: intent.redirectUrl } : {}),
      },
    };
  }

  /**
   * Step 3: capture, after one last stock check.
   *
   * This is the check PRD §29 exists for. A reservation lasts 15 minutes and
   * the partner keeps selling over the counter, so the stock can be gone
   * between holding it and taking the money.
   */
  async capture(
    principal: Principal,
    orderId: string,
  ): Promise<{ status: string; orderNumber: string }> {
    const [order] = await this.db.query<{
      id: string; order_number: string; user_id: string; status: string;
      total_minor: string; currency: string;
      payment_id: string; transaction_id: string | null;
    }>(
      `SELECT o.id, o.order_number, o.user_id, o.status, o.total_minor::text, o.currency,
              p.id AS payment_id, p.provider_transaction_id AS transaction_id
       FROM orders o
       JOIN payments p ON p.order_id = o.id AND p.status = 'AUTHORIZED'
       WHERE o.id = $1 AND o.user_id = $2`,
      [orderId, principal.userId],
    );
    if (!order) throw errors.notFound('Order');

    const items = await this.db.query<{ offer_id: string; quantity: number }>(
      `SELECT offer_id, quantity FROM order_items WHERE order_id = $1`,
      [orderId],
    );

    for (const item of items) {
      try {
        await this.verifyStock(item.offer_id, item.quantity, 'PRE_PAYMENT');
      } catch {
        // PRD §30: the money goes back, and no substitute is offered.
        await this.payments.void(order.transaction_id ?? '');
        await this.db.query(
          `UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
          [order.payment_id],
        );
        await this.db.query(
          `UPDATE orders SET status = 'FAILED', payment_status = 'CANCELLED',
                             cancellation_reason = 'STOCK_FAILURE', cancelled_at = now()
           WHERE id = $1`,
          [orderId],
        );
        await this.db.query(
          `UPDATE reservations SET status = 'RELEASED', released_at = now()
           WHERE order_id = $1 OR (user_id = $2 AND status = 'ACTIVE')`,
          [orderId, principal.userId],
        );
        await this.penaliseReliability(item.offer_id);

        throw new AppError({
          code: ErrorCode.STOCK_UNAVAILABLE,
          status: 409,
          message: 'The part sold out before the payment completed. Nothing was charged.',
          messageKey: 'error.stock.soldOutAtCapture',
          details: { orderNumber: order.order_number, refunded: true },
        });
      }
    }

    const result = await this.payments.capture(order.transaction_id ?? '', {
      amountMinor: BigInt(order.total_minor),
      currency: order.currency,
    });

    if (result.status === 'FAILED') {
      await this.failOrder(orderId, [], result.failureCode ?? 'capture_failed');
      throw new AppError({
        code: ErrorCode.PAYMENT_FAILED,
        status: 402,
        message: 'The payment could not be completed.',
        messageKey: 'error.payment.captureFailed',
      });
    }

    const pickupCode = randomBytes(3).readUIntBE(0, 3).toString().padStart(6, '0').slice(0, 6);

    await this.db.query(
      `UPDATE payments SET status = 'CAPTURED', captured_at = now(), updated_at = now()
       WHERE id = $1`,
      [order.payment_id],
    );
    await this.db.query(
      `UPDATE orders SET status = 'CONFIRMED', payment_status = 'CAPTURED', updated_at = now()
       WHERE id = $1`,
      [orderId],
    );
    await this.db.query(
      // Only the hash is stored: the code is shown to the customer once and
      // verified by comparison, never read back out of the database.
      `UPDATE partner_orders SET status = 'CONFIRMED', pickup_code_hash = $2, updated_at = now()
       WHERE order_id = $1`,
      [orderId, createHash('sha256').update(pickupCode).digest()],
    );

    const reservationRows = await this.db.query<{ id: string }>(
      `SELECT id FROM reservations WHERE user_id = $1 AND status = 'ACTIVE'`,
      [principal.userId],
    );
    await this.reservations.consume(reservationRows.map((r) => r.id), orderId);
    await this.cart.clear(principal.userId);

    this.logger.log(
      JSON.stringify({ event: 'order_paid', orderNumber: order.order_number, orderId }),
    );

    return { status: 'CONFIRMED', orderNumber: order.order_number };
  }

  async list(principal: Principal) {
    return this.db.query(
      `SELECT o.id, o.order_number, o.status, o.total_minor::text, o.currency,
              o.created_at, o.ready_for_pickup_at, o.pickup_deadline,
              pa.display_name AS partner_name,
              (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o
       LEFT JOIN partner_orders po ON po.order_id = o.id
       LEFT JOIN partners pa ON pa.id = po.partner_id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [principal.userId],
    );
  }

  async detail(principal: Principal, orderId: string) {
    const [order] = await this.db.query<Record<string, unknown>>(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.delivery_method,
              o.subtotal_minor::text, o.markup_minor::text, o.total_minor::text, o.currency,
              o.created_at, o.ready_for_pickup_at, o.pickup_deadline, o.completed_at,
              o.cancelled_at, o.cancellation_reason,
              pa.display_name AS partner_name,
              l.name AS location_name, l.address_line, l.working_hours, l.pickup_instructions
       FROM orders o
       LEFT JOIN partner_orders po ON po.order_id = o.id
       LEFT JOIN partners pa ON pa.id = po.partner_id
       LEFT JOIN partner_locations l ON l.id = po.location_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [orderId, principal.userId],
    );
    if (!order) throw errors.notFound('Order');

    const items = await this.db.query(
      `SELECT oi.id, oi.quantity, oi.line_total_minor::text, oi.currency,
              oi.fitment_verdict, oi.product_snapshot,
              v.custom_name AS vehicle_name
       FROM order_items oi
       LEFT JOIN vehicles v ON v.id = oi.vehicle_id
       WHERE oi.order_id = $1`,
      [orderId],
    );

    return {
      ...order,
      items,
      canCancel: canCustomerCancel(order['status'] as OrderStatus),
    };
  }

  /** PRD §51: cancellable until the partner marks it ready. */
  async cancel(principal: Principal, orderId: string): Promise<{ status: string }> {
    const [order] = await this.db.query<{
      id: string; status: OrderStatus; payment_id: string | null;
      transaction_id: string | null; total_minor: string; currency: string;
    }>(
      `SELECT o.id, o.status, p.id AS payment_id, p.provider_transaction_id AS transaction_id,
              o.total_minor::text, o.currency
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
       WHERE o.id = $1 AND o.user_id = $2`,
      [orderId, principal.userId],
    );
    if (!order) throw errors.notFound('Order');
    if (!canCustomerCancel(order.status)) throw errors.orderNotCancellable();

    if (order.payment_id && order.transaction_id) {
      await this.refund(orderId, order.payment_id, order.transaction_id, {
        amountMinor: BigInt(order.total_minor),
        currency: order.currency,
        reason: 'CUSTOMER_CANCEL',
        initiatedBy: principal.userId,
      });
    }

    await this.db.query(
      `UPDATE orders SET status = 'CANCELLED', cancelled_at = now(),
                         cancellation_reason = 'CUSTOMER_CANCEL', updated_at = now()
       WHERE id = $1`,
      [orderId],
    );
    await this.db.query(
      `UPDATE partner_orders SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1`,
      [orderId],
    );

    return { status: 'CANCELLED' };
  }

  /* ───────────────────────── internals ───────────────────────── */

  /**
   * The real-time check of PRD §29, recorded either way.
   *
   * Every call feeds `inventory_checks`, which is the only source for the
   * Inventory Accuracy KPI (docs/01 §8).
   */
  private async verifyStock(
    offerId: string,
    quantity: number,
    context: 'PRE_RESERVE' | 'PRE_PAYMENT' = 'PRE_RESERVE',
  ): Promise<void> {
    const [row] = await this.db.query<{
      available: number; availability_status: string; stock_quantity: number;
    }>(
      `SELECT GREATEST(av.available, 0) AS available, o.availability_status, o.stock_quantity
       FROM offers o JOIN offer_availability av ON av.offer_id = o.id
       WHERE o.id = $1 AND o.active`,
      [offerId],
    );
    if (!row) throw errors.notFound('Offer');

    // A reservation already holds the stock, so at capture time the remaining
    // availability excludes our own hold — compare against the raw count.
    const usable = context === 'PRE_PAYMENT' ? row.stock_quantity : row.available;
    const ok = row.availability_status !== 'IN_STOCK' || usable >= quantity;

    await this.db.query(
      `INSERT INTO inventory_checks (offer_id, believed_quantity, actual_quantity, matched, context)
       VALUES ($1, $2, $3, $4, $5)`,
      [offerId, quantity, usable, ok, context],
    );

    if (!ok) {
      throw errors.stockUnavailable({ offerId, requested: quantity, available: usable });
    }
  }

  private async totalsFor(items: { offerId: string; quantity: number; currency: string }[]) {
    let subtotal = 0n;
    let markup = 0n;
    let currency = items[0]?.currency ?? 'GEL';

    for (const item of items) {
      const [offer] = await this.db.query<{
        base_price_minor: string; platform_markup_minor: string; currency: string;
      }>(
        `SELECT base_price_minor::text, platform_markup_minor::text, currency
         FROM offers WHERE id = $1`,
        [item.offerId],
      );
      if (!offer) throw errors.notFound('Offer');
      subtotal += BigInt(offer.base_price_minor) * BigInt(item.quantity);
      markup += BigInt(offer.platform_markup_minor) * BigInt(item.quantity);
      currency = offer.currency;
    }

    return {
      subtotalMinor: subtotal.toString(),
      markupMinor: markup.toString(),
      totalMinor: (subtotal + markup).toString(),
      currency,
    };
  }

  async refund(
    orderId: string,
    paymentId: string,
    transactionId: string,
    input: { amountMinor: bigint; currency: string; reason: string; initiatedBy: string | null },
  ): Promise<void> {
    const idempotencyKey = `refund_${orderId}_${input.reason}_${randomUUID().slice(0, 8)}`;

    const result = await this.payments.refund(
      transactionId,
      { amountMinor: input.amountMinor, currency: input.currency },
      idempotencyKey,
    );

    await this.db.query(
      `INSERT INTO refunds (payment_id, order_id, amount_minor, currency, reason, status,
                            provider_refund_id, idempotency_key, initiated_by, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6::payment_status,$7,$8,$9,
               CASE WHEN $6 = 'REFUNDED' THEN now() END)`,
      [
        paymentId, orderId, input.amountMinor.toString(), input.currency, input.reason,
        result.status === 'REFUNDED' ? 'REFUNDED' : 'PENDING',
        result.refundId || null, idempotencyKey, input.initiatedBy,
      ],
    );

    await this.db.query(
      `UPDATE orders SET payment_status = 'REFUNDED', updated_at = now() WHERE id = $1`,
      [orderId],
    );

    this.logger.log(
      JSON.stringify({ event: 'refund', orderId, reason: input.reason, status: result.status }),
    );
  }

  private async failOrder(orderId: string, reservationIds: string[], reason: string): Promise<void> {
    await this.db.query(
      `UPDATE orders SET status = 'FAILED', cancellation_reason = $2, cancelled_at = now()
       WHERE id = $1`,
      [orderId, reason],
    );
    await this.reservations.release(reservationIds);
  }

  /**
   * A partner whose stock was wrong at capture loses reliability.
   *
   * That score drives Recommended ranking, so the consequence of inaccurate
   * stock is fewer sales — the incentive points the right way (docs/06 §10).
   */
  private async penaliseReliability(offerId: string): Promise<void> {
    await this.db.query(
      `UPDATE partners
       SET stock_reliability = GREATEST(0, stock_reliability - 0.02), updated_at = now()
       WHERE id = (SELECT partner_id FROM offers WHERE id = $1)`,
      [offerId],
    );
  }

  get pickupDeadline(): number {
    return this.pickupDeadlineHours;
  }
}

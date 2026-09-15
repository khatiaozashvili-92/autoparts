import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { createVinCipher, type VinCipher } from '@autoparts/db';
import { AppError, ErrorCode, errors, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { OrdersService } from './orders.service.js';
import type { AppConfig } from '../../config/configuration.js';

export interface PickupCredential {
  /** Six digits, shown as text and encoded in the QR (PRD §49). */
  code: string;
  orderNumber: string;
  expiresAt: string | null;
  partnerName: string;
  location: { name: string | null; address: string | null; workingHours: unknown };
}

/**
 * Pickup (PRD §48–52).
 *
 * The partner marks an order ready, which starts a 24-hour clock. The customer
 * shows a code; the partner verifies it; the customer confirms receipt, and
 * only that last step completes the order (PRD §50).
 */
@Injectable()
export class PickupService {
  private readonly logger = new Logger('PickupService');
  private readonly cipher: VinCipher;
  private readonly deadlineHours: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cipher = createVinCipher(config.get('VIN_ENCRYPTION_KEY', { infer: true }));
    this.deadlineHours = config.get('PICKUP_DEADLINE_HOURS', { infer: true });
  }

  /** Partner: "Mark as Ready for Pickup". Starts the 24-hour clock. */
  async markReady(partnerId: string, orderId: string): Promise<{ status: string; deadline: string }> {
    const [row] = await this.db.query<{
      id: string; order_id: string; status: string; order_status: string;
    }>(
      `SELECT po.id, po.order_id, po.status, o.status AS order_status
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       WHERE po.order_id = $1 AND po.partner_id = $2`,
      [orderId, partnerId],
    );
    if (!row) throw errors.notFound('Order');

    if (!['CONFIRMED', 'PAID', 'PREPARING'].includes(row.order_status)) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: `An order in state ${row.order_status} cannot be marked ready.`,
        messageKey: 'error.order.notPreparable',
        details: { status: row.order_status },
      });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const [updated] = await this.db.query<{ pickup_deadline: Date }>(
      `UPDATE orders
       SET status = 'READY_FOR_PICKUP',
           ready_for_pickup_at = now(),
           pickup_deadline = now() + ($2 || ' hours')::interval,
           updated_at = now()
       WHERE id = $1
       RETURNING pickup_deadline`,
      [orderId, this.deadlineHours],
    );

    await this.db.query(
      // Hash for verification, encrypted copy so the owner can look it up again.
      `UPDATE partner_orders
       SET status = 'READY_FOR_PICKUP', ready_at = now(),
           pickup_code_hash = $2, pickup_code_enc = $3, updated_at = now()
       WHERE id = $1`,
      [row.id, createHash('sha256').update(code).digest(), this.cipher.encrypt(code)],
    );

    this.logger.log(JSON.stringify({ event: 'ready_for_pickup', orderId, partnerId }));

    return { status: 'READY_FOR_PICKUP', deadline: updated!.pickup_deadline.toISOString() };
  }

  /** Customer: the code to show at the counter. */
  async credential(principal: Principal, orderId: string): Promise<PickupCredential> {
    const [row] = await this.db.query<{
      order_number: string; pickup_deadline: Date | null; pickup_code_enc: Buffer | null;
      status: string; partner_name: string; location_name: string | null;
      address_line: string | null; working_hours: unknown;
    }>(
      `SELECT o.order_number, o.pickup_deadline, po.pickup_code_enc, o.status,
              pa.display_name AS partner_name,
              l.name AS location_name, l.address_line, l.working_hours
       FROM orders o
       JOIN partner_orders po ON po.order_id = o.id
       JOIN partners pa ON pa.id = po.partner_id
       LEFT JOIN partner_locations l ON l.id = po.location_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [orderId, principal.userId],
    );
    if (!row) throw errors.notFound('Order');

    if (!row.pickup_code_enc) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: 'This order is not ready for pickup yet.',
        messageKey: 'error.order.notReady',
        details: { status: row.status },
      });
    }

    const code = this.cipher.decrypt(row.pickup_code_enc);
    if (!code) throw errors.internal();

    return {
      code,
      orderNumber: row.order_number,
      expiresAt: row.pickup_deadline?.toISOString() ?? null,
      partnerName: row.partner_name,
      location: {
        name: row.location_name,
        address: row.address_line,
        workingHours: row.working_hours,
      },
    };
  }

  /**
   * Partner: verify the code the customer presented.
   *
   * Compared in constant time against the stored hash. Verification moves the
   * order to PICKED_UP but not to COMPLETED — completion is the customer's to
   * give (PRD §50).
   */
  async verify(
    partnerId: string,
    orderId: string,
    code: string,
  ): Promise<{ status: string; orderNumber: string }> {
    const [row] = await this.db.query<{
      id: string; order_number: string; pickup_code_hash: Buffer | null; order_status: string;
    }>(
      `SELECT po.id, o.order_number, po.pickup_code_hash, o.status AS order_status
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       WHERE po.order_id = $1 AND po.partner_id = $2`,
      [orderId, partnerId],
    );
    if (!row) throw errors.notFound('Order');

    if (row.order_status !== 'READY_FOR_PICKUP') {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: `An order in state ${row.order_status} cannot be handed over.`,
        messageKey: 'error.order.notReady',
        details: { status: row.order_status },
      });
    }

    const supplied = createHash('sha256').update(code.trim()).digest();
    const stored = row.pickup_code_hash;
    const matches =
      stored !== null && stored.length === supplied.length && timingSafeEqual(stored, supplied);

    if (!matches) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'The pickup code does not match.',
        messageKey: 'error.pickup.codeMismatch',
      });
    }

    await this.db.query(
      `UPDATE orders SET status = 'PICKED_UP', picked_up_at = now(), updated_at = now()
       WHERE id = $1`,
      [orderId],
    );
    await this.db.query(
      `UPDATE partner_orders SET status = 'PICKED_UP', updated_at = now() WHERE id = $1`,
      [row.id],
    );

    return { status: 'PICKED_UP', orderNumber: row.order_number };
  }

  /** Customer confirms receipt. This is what completes the order (PRD §50). */
  async confirmReceipt(principal: Principal, orderId: string): Promise<{ status: string }> {
    const [row] = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, principal.userId],
    );
    if (!row) throw errors.notFound('Order');

    if (!['READY_FOR_PICKUP', 'PICKED_UP'].includes(row.status)) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: `An order in state ${row.status} cannot be confirmed as received.`,
        messageKey: 'error.order.notReceivable',
        details: { status: row.status },
      });
    }

    await this.db.query(
      `UPDATE orders SET status = 'COMPLETED', completed_at = now(),
                         picked_up_at = COALESCE(picked_up_at, now()), updated_at = now()
       WHERE id = $1`,
      [orderId],
    );
    await this.db.query(
      `UPDATE partner_orders SET status = 'COMPLETED', updated_at = now() WHERE order_id = $1`,
      [orderId],
    );

    return { status: 'COMPLETED' };
  }

  /**
   * The 24-hour no-show sweep (PRD §52).
   *
   * Cancels and refunds in full. The partner is not penalised: they prepared
   * the part and did nothing wrong, so this does not touch their reliability
   * score (docs/08 §6.1).
   */
  async cancelNoShows(): Promise<number> {
    const rows = await this.db.query<{
      id: string; order_number: string; payment_id: string | null;
      transaction_id: string | null; total_minor: string; currency: string;
    }>(
      `SELECT o.id, o.order_number, p.id AS payment_id,
              p.provider_transaction_id AS transaction_id,
              o.total_minor::text, o.currency
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
       WHERE o.status = 'READY_FOR_PICKUP'
         AND o.pickup_deadline IS NOT NULL
         AND o.pickup_deadline <= now()`,
    );

    for (const row of rows) {
      if (row.payment_id && row.transaction_id) {
        await this.orders.refund(row.id, row.payment_id, row.transaction_id, {
          amountMinor: BigInt(row.total_minor),
          currency: row.currency,
          reason: 'NO_SHOW',
          initiatedBy: null,
        });
      }

      await this.db.query(
        `UPDATE orders SET status = 'CANCELLED', cancelled_at = now(),
                           cancellation_reason = 'NO_SHOW', updated_at = now()
         WHERE id = $1`,
        [row.id],
      );
      await this.db.query(
        `UPDATE partner_orders SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1`,
        [row.id],
      );

      this.logger.log(
        JSON.stringify({ event: 'no_show_cancelled', orderNumber: row.order_number }),
      );
    }

    return rows.length;
  }

  /** Partner: the order queue. */
  async partnerOrders(partnerId: string, status?: string) {
    return this.db.query(
      `SELECT o.id, o.order_number, o.status, o.total_minor::text, o.currency,
              o.created_at, o.ready_for_pickup_at, o.pickup_deadline,
              u.first_name, u.phone,
              -- The car, so the right part is pulled. Never the VIN: the partner
              -- does not need it, so they do not get it (docs/07 §7).
              concat_ws(' ', c.make, c.model, c.model_year) AS vehicle,
              c.engine,
              (SELECT jsonb_agg(jsonb_build_object(
                 'quantity', oi.quantity,
                 'product', oi.product_snapshot,
                 'basePriceMinor', oi.base_price_minor::text))
               FROM order_items oi WHERE oi.order_id = o.id) AS items
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       JOIN users u ON u.id = o.user_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN vehicle_configurations c ON c.id = v.configuration_id
       WHERE po.partner_id = $1
         AND ($2::text IS NULL OR o.status::text = $2)
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [partnerId, status ?? null],
    );
  }
}

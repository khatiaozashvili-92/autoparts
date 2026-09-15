import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { errors } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import type { AppConfig } from '../../config/configuration.js';

export interface Reservation {
  id: string;
  offerId: string;
  quantity: number;
  expiresAt: string;
}

/**
 * Stock reservations (PRD §28, docs/06 §7).
 *
 * A reservation holds marketplace availability for 15 minutes while the
 * customer pays. It never touches the partner's own ERP stock — they keep
 * selling over the counter, and the final check before capture is what catches
 * a collision (R2).
 *
 * Concurrency is guarded by a Postgres advisory lock rather than Redis. Redis
 * arrives with the queue work in a later step, and a distributed lock is not
 * needed for a guard that already sits inside the transaction it protects
 * (ADR-012).
 */
@Injectable()
export class ReservationService {
  private readonly logger = new Logger('ReservationService');
  private readonly ttlMinutes: number;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlMinutes = config.get('RESERVATION_TTL_MINUTES', { infer: true });
  }

  /**
   * Reserves stock, or fails with what is actually available.
   *
   * The advisory lock serialises reservations for one offer; `FOR UPDATE` on
   * the offer row then holds that serialisation for the length of the
   * transaction. Either alone leaves a window: the lock is released on commit,
   * and the row lock does not cover the aggregate over `reservations`.
   */
  async reserve(params: {
    offerId: string;
    userId: string;
    quantity: number;
  }): Promise<Reservation> {
    const client = await this.db.raw.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey(params.offerId)]);

      const { rows } = await client.query<{
        available: number;
        availability_status: string;
        active: boolean;
      }>(
        `SELECT GREATEST(av.available, 0) AS available, o.availability_status, o.active
         FROM offers o
         JOIN offer_availability av ON av.offer_id = o.id
         WHERE o.id = $1
         FOR UPDATE OF o`,
        [params.offerId],
      );

      const offer = rows[0];
      if (!offer || !offer.active) {
        await client.query('ROLLBACK');
        throw errors.notFound('Offer');
      }

      // Only physical stock can be held. An AVAILABLE_TO_ORDER item has nothing
      // to reserve — the partner has yet to obtain it (PRD §27).
      if (offer.availability_status !== 'IN_STOCK') {
        await client.query('ROLLBACK');
        throw errors.stockUnavailable({
          offerId: params.offerId,
          reason: 'NOT_IN_STOCK',
          availability: offer.availability_status,
        });
      }

      if (offer.available < params.quantity) {
        await client.query('ROLLBACK');
        throw errors.stockUnavailable({
          offerId: params.offerId,
          requested: params.quantity,
          available: offer.available,
        });
      }

      const { rows: created } = await client.query<{
        id: string;
        expires_at: Date;
      }>(
        `INSERT INTO reservations (offer_id, user_id, quantity, status, expires_at)
         VALUES ($1, $2, $3, 'ACTIVE', now() + ($4 || ' minutes')::interval)
         RETURNING id, expires_at`,
        [params.offerId, params.userId, params.quantity, this.ttlMinutes],
      );

      await client.query('COMMIT');

      const row = created[0]!;
      return {
        id: row.id,
        offerId: params.offerId,
        quantity: params.quantity,
        expiresAt: row.expires_at.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Marks reservations as consumed once their order is paid. */
  async consume(reservationIds: string[], orderId: string): Promise<void> {
    if (reservationIds.length === 0) return;
    await this.db.query(
      `UPDATE reservations
       SET status = 'CONSUMED', order_id = $2
       WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
      [reservationIds, orderId],
    );
  }

  async release(reservationIds: string[]): Promise<void> {
    if (reservationIds.length === 0) return;
    await this.db.query(
      `UPDATE reservations
       SET status = 'RELEASED', released_at = now()
       WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
      [reservationIds],
    );
  }

  /** Throws if any reservation has lapsed. Checked before taking money. */
  async assertActive(reservationIds: string[]): Promise<void> {
    if (reservationIds.length === 0) return;
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM reservations
       WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' AND expires_at > now()`,
      [reservationIds],
    );
    if (rows.length !== reservationIds.length) throw errors.reservationExpired();
  }

  /**
   * Expires lapsed reservations.
   *
   * The availability view already ignores anything past `expires_at`, so stock
   * is freed the moment the clock passes — this sweep only keeps the rows
   * honest for reporting. Correctness does not depend on it having run.
   */
  async expireLapsed(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE reservations
       SET status = 'EXPIRED', released_at = now()
       WHERE status = 'ACTIVE' AND expires_at <= now()
       RETURNING id`,
    );
    if (rows.length > 0) {
      this.logger.log(JSON.stringify({ event: 'reservations_expired', count: rows.length }));
    }
    return rows.length;
  }
}

/** A stable 64-bit key per offer for pg_advisory_xact_lock. */
function lockKey(offerId: string): string {
  const digest = createHash('sha1').update(offerId).digest();
  // Signed 64-bit, which is what the advisory lock functions take.
  return BigInt.asIntN(64, digest.readBigUInt64BE(0)).toString();
}

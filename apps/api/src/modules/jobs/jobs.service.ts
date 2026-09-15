import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ReservationService } from '../orders/reservation.service.js';
import { PickupService } from '../orders/pickup.service.js';
import { DatabaseService } from '../../database/database.module.js';

/**
 * Periodic work (PRD §52, §28).
 *
 * Plain timers rather than a queue. BullMQ needs Redis, which arrives with the
 * caching work; these two jobs are idempotent sweeps over a small table, so a
 * queue would add an operational dependency without buying anything.
 *
 * Correctness does not rest on either job running on time:
 *  - expired reservations are already excluded by `offer_availability`, so
 *    stock frees itself at the deadline whether or not the sweep has run;
 *  - a no-show order stays READY_FOR_PICKUP until cancelled, which is the safe
 *    direction — nobody is charged twice and nothing is lost by a late sweep.
 *
 * A Postgres advisory lock keeps two API instances from doing the same refunds.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private timers: NodeJS.Timeout[] = [];

  private static readonly RESERVATION_SWEEP_MS = 30_000;
  private static readonly NO_SHOW_SWEEP_MS = 5 * 60_000;
  private static readonly LOCK_KEY = 8_421_337;

  constructor(
    private readonly db: DatabaseService,
    private readonly reservations: ReservationService,
    private readonly pickup: PickupService,
  ) {}

  onModuleInit(): void {
    if (!this.db.configured) {
      this.logger.warn('No database configured; background jobs are not scheduled.');
      return;
    }

    this.timers.push(
      setInterval(() => {
        void this.run('reservations', () => this.reservations.expireLapsed());
      }, JobsService.RESERVATION_SWEEP_MS),
      setInterval(() => {
        void this.run('no_show', () => this.pickup.cancelNoShows());
      }, JobsService.NO_SHOW_SWEEP_MS),
    );

    // unref so the timers never hold the process open during shutdown or tests.
    for (const timer of this.timers) timer.unref();
    this.logger.log('Background sweeps scheduled');
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** Exposed so tests and the admin panel can force a sweep. */
  async runNow(): Promise<{ reservations: number; noShows: number }> {
    return {
      reservations: await this.reservations.expireLapsed(),
      noShows: await this.pickup.cancelNoShows(),
    };
  }

  private async run(name: string, work: () => Promise<number>): Promise<void> {
    const client = await this.db.raw.connect();
    try {
      // Non-blocking: if another instance holds it, skip this tick rather than
      // queue up behind it.
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [JobsService.LOCK_KEY],
      );
      if (!rows[0]?.locked) return;

      try {
        await work();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [JobsService.LOCK_KEY]);
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'job_failed',
          job: name,
          error: error instanceof Error ? error.message : 'unknown',
        }),
      );
    } finally {
      client.release();
    }
  }
}

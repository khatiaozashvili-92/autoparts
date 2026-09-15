import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/configuration.js';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Database access.
 *
 * The pool is optional on purpose: until DATABASE_URL is set the API still
 * boots and reports the database as not configured, so the skeleton stays
 * inspectable (docs/02 §7). Once configured, a missing database is a real
 * failure and is reported as such.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger('Database');

  constructor(@Inject(PG_POOL) private readonly pool: Pool | null) {}

  get configured(): boolean {
    return this.pool !== null;
  }

  get raw(): Pool {
    if (!this.pool) throw new Error('DATABASE_URL is not configured.');
    return this.pool;
  }

  async query<T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.raw.query<T>(sql, params as unknown[]);
    return result.rows;
  }

  /** Round-trips a trivial statement so the probe reflects the real connection. */
  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (!this.pool) return { ok: false, latencyMs: 0, error: 'not configured' };
    const started = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  /** Number of migrations recorded as applied, or null if the ledger is absent. */
  async migrationCount(): Promise<number | null> {
    if (!this.pool) return null;
    try {
      const { rows } = await this.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM schema_migrations`,
      );
      return Number(rows[0]?.n ?? 0);
    } catch {
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('Connection pool closed');
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): Pool | null => {
        const url = config.get('DATABASE_URL', { infer: true });
        if (!url) return null;
        return new Pool({
          connectionString: url,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        });
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService, PG_POOL],
})
export class DatabaseModule {}

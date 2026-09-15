import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';

/**
 * Plain-SQL migration runner.
 *
 * The schema leans on PostgreSQL features a schema-definition DSL cannot
 * express — generated columns, CHECK constraints, partial and expression
 * indexes, a view (ADR-008). Those constraints are the enforcement mechanism
 * for the data-quality rules in docs/01 §7, so the migrations are written in
 * SQL and this runner applies them.
 */

export interface MigrationRecord {
  name: string;
  checksum: string;
  appliedAt: Date;
}

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

function checksum(sql: string): string {
  // Normalize line endings so a Windows checkout and a Linux CI agree.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

export async function appliedMigrations(pool: Pool): Promise<Map<string, MigrationRecord>> {
  await pool.query(LEDGER);
  const { rows } = await pool.query<{ name: string; checksum: string; applied_at: Date }>(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
  );
  return new Map(
    rows.map((r) => [r.name, { name: r.name, checksum: r.checksum, appliedAt: r.applied_at }]),
  );
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(pool: Pool, dir: string): Promise<MigrateResult> {
  const files = await listMigrationFiles(dir);
  const already = await appliedMigrations(pool);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    const sum = checksum(sql);
    const record = already.get(file);

    if (record) {
      // An edited migration means the database and the repository disagree
      // about history. Silently ignoring that is how environments drift.
      if (record.checksum !== sum) {
        throw new Error(
          `Migration "${file}" has changed since it was applied.\n` +
            `  applied checksum: ${record.checksum}\n` +
            `  current checksum: ${sum}\n` +
            `Applied migrations are immutable — add a new migration instead.`,
        );
      }
      skipped.push(file);
      continue;
    }

    const client: PoolClient = await pool.connect();
    try {
      // Each file wraps itself in BEGIN/COMMIT, so the ledger row is written
      // in its own statement afterwards; a failed file leaves no row behind.
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [file, sum],
      );
      applied.push(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration "${file}" failed: ${message}`);
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}

/**
 * Drops and recreates the public schema. Development only — refuses to run
 * against anything that is not obviously a local database.
 */
export async function reset(pool: Pool, connectionString: string): Promise<void> {
  const isLocal = /(localhost|127\.0\.0\.1)/.test(connectionString);
  if (!isLocal || process.env.NODE_ENV === 'production') {
    throw new Error('reset is refused: this does not look like a local database.');
  }
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

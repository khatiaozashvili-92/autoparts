import { Pool } from 'pg';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { migrate, appliedMigrations, listMigrationFiles, reset } from './migrator.js';
import { seed } from './seed.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'db/migrations');

loadEnv({ path: resolve(REPO_ROOT, '.env') });

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return url;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';
  const url = connectionString();
  const pool = new Pool({ connectionString: url });

  try {
    switch (command) {
      case 'migrate': {
        const { applied, skipped } = await migrate(pool, MIGRATIONS_DIR);
        for (const name of skipped) console.log(`  = ${name}`);
        for (const name of applied) console.log(`  + ${name}`);
        console.log(
          applied.length ? `\n${applied.length} migration(s) applied.` : '\nAlready up to date.',
        );
        break;
      }

      case 'status': {
        const files = await listMigrationFiles(MIGRATIONS_DIR);
        const already = await appliedMigrations(pool);
        for (const file of files) {
          const record = already.get(file);
          console.log(
            record
              ? `  applied  ${file}  (${record.appliedAt.toISOString()})`
              : `  pending  ${file}`,
          );
        }
        const pending = files.filter((f) => !already.has(f)).length;
        console.log(`\n${files.length} migration(s), ${pending} pending.`);
        break;
      }

      case 'seed': {
        const counts = await seed(pool);
        for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`);
        break;
      }

      case 'reset': {
        await reset(pool, url);
        console.log('Schema dropped. Run migrate next.');
        break;
      }

      default:
        console.error(`Unknown command "${command}". Use: migrate | status | seed | reset`);
        process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

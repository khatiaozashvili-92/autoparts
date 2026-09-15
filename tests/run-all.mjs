/**
 * Runs every end-to-end suite in order.
 *
 * With a pause between suites: auth is rate limited per IP (10/minute, docs/04
 * §10) and six suites back to back legitimately trip it. The limiter working is
 * the point — the harness waits rather than the product loosening.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SUITES = [
  'e2e-vin-garage',
  'e2e-catalog-fitment',
  'e2e-partner',
  'e2e-search',
  'e2e-purchase',
  'e2e-admin',
];

const PAUSE_MS = 62_000;

function run(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`tests/${name}.mjs`], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let failed = 0;
for (const [index, suite] of SUITES.entries()) {
  console.log(`\n${'='.repeat(60)}\n${suite}\n${'='.repeat(60)}`);
  const code = await run(suite);
  if (code !== 0) failed++;
  if (index < SUITES.length - 1) {
    console.log(`\n(waiting ${PAUSE_MS / 1000}s for the auth rate-limit window)`);
    await sleep(PAUSE_MS);
  }
}

console.log(`\n${SUITES.length - failed}/${SUITES.length} suites passed`);
process.exit(failed === 0 ? 0 : 1);

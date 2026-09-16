import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the repo-root .env.
 *
 * The API resolves that same file explicitly (see ConfigModule's envFilePath),
 * so the README's "one .env at the repo root serves the whole monorepo" is
 * true for it — but Next only ever looks in its own app directory. Without
 * this the web app silently falls back to its defaults, and the failure is
 * invisible until runtime: NEXT_PUBLIC_* values are inlined at build time, so
 * a deployment bakes `http://localhost:3001` into the browser bundle and every
 * request from the deployed page goes to the visitor's own machine.
 *
 * Read by hand rather than with dotenv so the web app does not take a
 * dependency purely to read six lines of KEY=value.
 */
function loadRootEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootEnv = resolve(here, '../../.env');

  let contents;
  try {
    contents = readFileSync(rootEnv, 'utf8');
  } catch {
    // Absent in CI and in a container that passes real environment variables
    // instead. Both are fine; anything already set wins regardless.
    return;
  }

  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    // A real environment variable always beats the file, so a deployment can
    // override without editing it.
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

loadRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@autoparts/core', '@autoparts/api-client', '@autoparts/i18n'],
  env: {
    // Named explicitly so the value is inlined from whatever loadRootEnv found.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  },
};
export default nextConfig;

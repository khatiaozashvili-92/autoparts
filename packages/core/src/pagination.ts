/**
 * Cursor pagination (docs/04 §1.3).
 *
 * Offset pagination drifts when rows are inserted mid-scroll, which in a
 * marketplace means duplicated or skipped offers. Cursors are opaque to
 * clients — the encoding is an implementation detail and may change.
 *
 * This module runs in Node, the browser and React Native, so it uses the
 * web-standard `btoa`/`atob` and `TextEncoder` rather than Node's `Buffer`.
 */

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface PageQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(cursor))) as T;
  } catch {
    return null;
  }
}

export function page<T>(data: T[], nextCursor: string | null = null): Page<T> {
  return { data, nextCursor };
}

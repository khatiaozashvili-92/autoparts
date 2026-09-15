import type { Principal } from '@autoparts/core';

/**
 * Request augmentation.
 *
 * `principal` is populated by the auth middleware from the JWT and is the ONLY
 * source of identity — a partnerId arriving in a request body or query string
 * is never trusted (docs/07 §5.1).
 */
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      principal?: Principal;
    }
  }
}

export {};

import { VinNotDecodableError, maskVin, normalizeVin, validateVin } from '@autoparts/core';
import type { VinDecodeResult } from '@autoparts/core';
import type { FitmentProvider } from './fitment-provider.interface.js';

export interface ChainAttempt {
  provider: string;
  outcome: 'skipped' | 'ok' | 'failed';
  reason?: string;
  durationMs?: number;
}

export interface ChainResult extends VinDecodeResult {
  attempts: ChainAttempt[];
  /** True when the check digit failed but a provider identified the car anyway. */
  checksumSuspect: boolean;
}

/**
 * Primary provider, then fallback (docs/02 §4.1).
 *
 * `supports()` is consulted before each call so a provider that cannot decode
 * this VIN is skipped rather than paid for and timed out. Every attempt is
 * recorded, because "which provider answered, and what did the others say" is
 * the first question when a decode looks wrong.
 */
export class FitmentProviderChain {
  constructor(private readonly providers: FitmentProvider[]) {
    if (providers.length === 0) {
      throw new Error('FitmentProviderChain requires at least one provider.');
    }
  }

  get names(): string[] {
    return this.providers.map((p) => p.name);
  }

  async decodeVin(vin: string): Promise<ChainResult> {
    const normalized = normalizeVin(vin);
    const validation = validateVin(normalized);
    const attempts: ChainAttempt[] = [];

    if (!validation.structurallyValid) {
      throw new VinNotDecodableError(
        maskVin(normalized),
        'validation',
        `VIN is not structurally valid: ${validation.reason}`,
      );
    }

    const checksumSuspect = validation.checksumValid === false;

    for (const provider of this.providers) {
      // A suspect check digit usually means a typo. Free providers are still
      // worth asking — they are a better judge than our arithmetic — but a
      // paid one is not spent on it (docs/02 §4.1).
      if (checksumSuspect && provider.capabilities().costPerCallMinor !== null) {
        attempts.push({
          provider: provider.name,
          outcome: 'skipped',
          reason: 'check digit failed; not spending a paid lookup',
        });
        continue;
      }

      if (!provider.supports(normalized)) {
        attempts.push({
          provider: provider.name,
          outcome: 'skipped',
          reason: 'VIN outside this provider’s supported markets',
        });
        continue;
      }

      const started = Date.now();
      try {
        const result = await provider.decodeVin(normalized);
        attempts.push({
          provider: provider.name,
          outcome: 'ok',
          durationMs: Date.now() - started,
        });
        return { ...result, attempts, checksumSuspect };
      } catch (error) {
        attempts.push({
          provider: provider.name,
          outcome: 'failed',
          reason: error instanceof Error ? error.message : 'unknown error',
          durationMs: Date.now() - started,
        });
      }
    }

    // Every provider skipped or failed. The caller falls back to manual entry
    // (PRD §43) rather than the user being left with nothing.
    throw new VinNotDecodableError(maskVin(normalized), this.names.join(' → '));
  }
}

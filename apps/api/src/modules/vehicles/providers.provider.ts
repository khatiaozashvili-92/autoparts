import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FitmentProviderChain,
  MockFitmentProvider,
  NhtsaVpicProvider,
  BRAKE_CONFIG_CLARIFICATION,
  type FitmentProvider,
} from '@autoparts/providers';
import { VEHICLES as SEED_VEHICLES } from '@autoparts/db';
import type { AppConfig } from '../../config/configuration.js';

export const FITMENT_PROVIDER_CHAIN = Symbol('FITMENT_PROVIDER_CHAIN');

function buildProvider(name: string): FitmentProvider {
  switch (name) {
    case 'nhtsa_vpic':
      return new NhtsaVpicProvider();

    case 'mock':
      return new MockFitmentProvider(
        SEED_VEHICLES.map((v) => ({
          vin: v.vin,
          make: v.make,
          model: v.model,
          modelYear: v.year,
          generation: v.generation ?? null,
          engine: v.engine,
          engineCode: v.engineCode,
          fuelType: v.fuelType,
          transmission: v.transmission,
          driveType: v.driveType,
          bodyType: v.bodyType,
          trim: v.trim ?? null,
          market: v.market as 'US' | 'EU',
          // The BMW is the PRD's worked example for an ambiguous configuration
          // (§10), so it is the one that asks a clarifying question.
          clarifications: v.make === 'BMW' ? [BRAKE_CONFIG_CLARIFICATION] : [],
        })),
      );

    default:
      throw new Error(
        `Unknown fitment provider "${name}". Valid values: mock, nhtsa_vpic.`,
      );
  }
}

/**
 * Builds the primary → fallback chain from configuration (docs/02 §7.1).
 *
 * Which providers run is an environment decision, never a code one: that is
 * what lets local development and CI run entirely on the mock while production
 * calls the real thing (PRD §101).
 */
export const fitmentChainProvider: Provider = {
  provide: FITMENT_PROVIDER_CHAIN,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): FitmentProviderChain => {
    const primaryName = config.get('FITMENT_PROVIDER_PRIMARY', { infer: true });
    const fallbackName = config.get('FITMENT_PROVIDER_FALLBACK', { infer: true });

    const providers = [buildProvider(primaryName)];
    if (fallbackName && fallbackName !== primaryName) {
      providers.push(buildProvider(fallbackName));
    }

    new Logger('FitmentProviders').log(
      `Chain: ${providers.map((p) => p.name).join(' → ')}`,
    );
    return new FitmentProviderChain(providers);
  },
};

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/common.js';
import type { AppConfig } from '../../config/configuration.js';
import {
  FitmentVerdict,
  OrderStatus,
  UserRole,
  SELLABLE_VERDICTS,
  FITMENT_SOURCE_PRIORITY,
  permissionsFor,
} from '@autoparts/core';

/**
 * Non-secret runtime metadata.
 *
 * Exposes which providers, locale defaults and feature flags this deployment
 * is running with, plus the domain vocabulary the clients must agree on. It
 * is the fastest way to tell a staging box from production at a glance —
 * and during Step 1 it is the proof that config and the shared domain package
 * are actually wired together.
 */
@ApiTags('meta')
@Controller('meta')
export class MetaController {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Runtime configuration and domain vocabulary' })
  meta() {
    const get = <K extends keyof AppConfig>(key: K) => this.config.get(key, { infer: true });

    return {
      service: 'autoparts-api',
      version: '0.1.0',
      environment: get('NODE_ENV'),
      buildStep: { current: 3, name: 'Vehicle / VIN', total: 12 },

      providers: {
        fitmentPrimary: get('FITMENT_PROVIDER_PRIMARY'),
        fitmentFallback: get('FITMENT_PROVIDER_FALLBACK'),
        payment: get('PAYMENT_PROVIDER'),
      },

      // Defaults for this deployment — not facts baked into the code (PRD §80).
      defaults: {
        country: get('DEFAULT_COUNTRY'),
        currency: get('DEFAULT_CURRENCY'),
        locale: get('DEFAULT_LOCALE'),
      },

      features: {
        requestPart: get('FEATURE_REQUEST_PART'),
        courierDelivery: get('FEATURE_COURIER_DELIVERY'),
        reviews: get('FEATURE_REVIEWS'),
      },

      rules: {
        fitmentMinConfidence: get('FITMENT_MIN_CONFIDENCE'),
        reservationTtlMinutes: get('RESERVATION_TTL_MINUTES'),
        pickupDeadlineHours: get('PICKUP_DEADLINE_HOURS'),
      },

      domain: {
        fitmentVerdicts: Object.values(FitmentVerdict),
        sellableVerdicts: SELLABLE_VERDICTS,
        fitmentSourcePriority: FITMENT_SOURCE_PRIORITY,
        orderStatuses: Object.values(OrderStatus),
        roles: Object.fromEntries(
          Object.values(UserRole).map((role) => [role, permissionsFor([role])]),
        ),
      },
    };
  }
}

import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockPaymentProvider, type PaymentProvider } from '@autoparts/providers';
import type { AppConfig } from '../../config/configuration.js';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * Chosen by configuration, never by code (PRD §44).
 *
 * Only the mock exists so far: the acquiring contract is still open, and that
 * is a commercial blocker rather than a technical one (docs/00, open issue #1).
 * Everything up to the capture call is finished and exercised against the mock.
 */
export const paymentProviderFactory: Provider = {
  provide: PAYMENT_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): PaymentProvider => {
    const name = config.get('PAYMENT_PROVIDER', { infer: true });
    const logger = new Logger('PaymentProvider');

    switch (name) {
      case 'mock':
        logger.log('Using the mock payment provider — no money moves.');
        return new MockPaymentProvider();
      default:
        throw new Error(
          `Unknown payment provider "${name}". Only "mock" is implemented; a real ` +
            `acquirer adapter is added when the contract is signed.`,
        );
    }
  },
};

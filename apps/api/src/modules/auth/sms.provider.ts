import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider, createSmsProvider, type SmsProvider } from '@autoparts/providers';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Which gateway sends the codes is a deployment decision (docs/02 §7.1), so it
 * is resolved here from configuration and injected by token — no service ever
 * names a provider.
 */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export const smsProvider: Provider = {
  provide: SMS_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): SmsProvider => {
    const name = config.get('SMS_PROVIDER', { infer: true });
    if (name === 'console') {
      // Routed through Nest's logger so the code lands in the same stream as
      // the rest of the API, where a developer is already looking.
      const logger = new Logger('Sms');
      return new ConsoleSmsProvider((line) => logger.log(line));
    }
    return createSmsProvider(name);
  },
};

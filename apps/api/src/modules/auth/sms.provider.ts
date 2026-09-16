import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider, createSmsProvider, type SmsProvider } from '@autoparts/providers';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Which gateway sends the codes is a deployment decision (docs/02 §7.1), so it
 * is resolved here from configuration and injected by token — no service ever
 * names a provider.
 *
 * Misconfiguration fails here, at startup, rather than on a customer's first
 * sign-in: `createSmsProvider` throws when the credentials for the chosen
 * gateway are missing, and a process that cannot send a code should not be
 * accepting traffic at all.
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

    const provider = createSmsProvider(name, {
      twilio: config.get('TWILIO_ACCOUNT_SID', { infer: true })
        ? {
            accountSid: config.get('TWILIO_ACCOUNT_SID', { infer: true }),
            authToken: config.get('TWILIO_AUTH_TOKEN', { infer: true }),
            from: config.get('TWILIO_FROM', { infer: true }),
          }
        : undefined,
      http: config.get('SMS_HTTP_URL', { infer: true })
        ? {
            url: config.get('SMS_HTTP_URL', { infer: true }),
            method: config.get('SMS_HTTP_METHOD', { infer: true }),
            toParam: config.get('SMS_HTTP_TO_PARAM', { infer: true }),
            textParam: config.get('SMS_HTTP_TEXT_PARAM', { infer: true }),
            senderParam: config.get('SMS_HTTP_SENDER_PARAM', { infer: true }),
            sender: config.get('SMS_HTTP_SENDER', { infer: true }),
            keyParam: config.get('SMS_HTTP_KEY_PARAM', { infer: true }),
            key: config.get('SMS_HTTP_KEY', { infer: true }),
            authHeader: config.get('SMS_HTTP_AUTH_HEADER', { infer: true }) || undefined,
            stripPlus: config.get('SMS_HTTP_STRIP_PLUS', { infer: true }),
            successPattern:
              config.get('SMS_HTTP_SUCCESS_PATTERN', { infer: true }) || undefined,
          }
        : undefined,
    });

    new Logger('Sms').log(`Gateway: ${provider.name}`);
    return provider;
  },
};

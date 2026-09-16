import { HttpSmsProvider, type HttpSmsConfig } from './http.provider.js';
import { TwilioSmsProvider } from './twilio.provider.js';

/**
 * SMS provider seam (docs/08 §5).
 *
 * No Georgian aggregator is named in the code, for the same reason no acquirer
 * is: which gateway delivers a message is a deployment decision, and the
 * contract is still open. Development and CI run on the console provider, and
 * switching to a real gateway is one adapter.
 */

export interface SmsMessage {
  /** E.164, normalised by the caller. */
  to: string;
  body: string;
}

export interface SmsResult {
  provider: string;
  messageId: string;
  status: 'SENT' | 'FAILED';
  failureCode?: string;
}

export interface SmsProvider {
  readonly name: string;
  /** True when the provider can hand the code back for display in dev. */
  readonly echoesCode: boolean;
  send(message: SmsMessage): Promise<SmsResult>;
}

/**
 * Development and CI provider.
 *
 * Writes the message to the log and keeps the last one per number so the API
 * can echo the code back outside production. Without the echo there is no way
 * to sign in on a machine that has no SMS gateway, which is every developer
 * machine and every CI runner.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  readonly echoesCode = true;

  private readonly lastByPhone = new Map<string, SmsMessage>();
  private counter = 0;

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    this.lastByPhone.set(message.to, message);
    this.log(`[sms:console] → ${message.to}  ${message.body}`);
    return {
      provider: this.name,
      messageId: `console-${++this.counter}`,
      status: 'SENT',
    };
  }

  lastMessageTo(phone: string): SmsMessage | undefined {
    return this.lastByPhone.get(phone);
  }
}

/**
 * Provider that always fails, for exercising the "code did not arrive" path.
 *
 * A gateway that only ever succeeds hides the branch that matters: the
 * customer is left on the code screen with no code, and the API has to say so
 * rather than pretend the message is in flight.
 */
export class FailingSmsProvider implements SmsProvider {
  readonly name = 'failing';
  readonly echoesCode = false;

  async send(_message: SmsMessage): Promise<SmsResult> {
    return {
      provider: this.name,
      messageId: '',
      status: 'FAILED',
      failureCode: 'GATEWAY_UNAVAILABLE',
    };
  }
}

/**
 * Everything a real gateway needs, read from configuration.
 *
 * Passed in rather than read from `process.env` here, so this package stays
 * free of any opinion about where configuration comes from — the API's
 * `loadConfig` is the one place the environment is parsed and validated.
 */
export interface SmsProviderOptions {
  twilio?: { accountSid: string; authToken: string; from: string };
  http?: HttpSmsConfig;
}

export function createSmsProvider(name: string, options: SmsProviderOptions = {}): SmsProvider {
  switch (name) {
    case 'console':
      return new ConsoleSmsProvider();
    case 'failing':
      return new FailingSmsProvider();
    case 'twilio':
      if (!options.twilio) {
        throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.');
      }
      return new TwilioSmsProvider(options.twilio);
    case 'http':
      if (!options.http) {
        throw new Error('SMS_PROVIDER=http needs at least SMS_HTTP_URL, SMS_HTTP_TO_PARAM and SMS_HTTP_TEXT_PARAM.');
      }
      return new HttpSmsProvider(options.http);
    default:
      throw new Error(
        `Unknown SMS provider "${name}". Configure SMS_PROVIDER to one of: console, failing, twilio, http.`,
      );
  }
}

import type { SmsMessage, SmsProvider, SmsResult } from './sms-provider.js';

/**
 * Twilio.
 *
 * Worth having as the first real adapter even though a Georgian aggregator
 * will almost certainly be cheaper per message: Twilio needs no local company
 * to sign up, so it is the one gateway that can be switched on the same day a
 * decision is made. Useful for a pilot, and for proving the rest of the
 * pipeline works before a local contract is signed.
 */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /**
   * The number or alphanumeric sender the message comes from.
   *
   * An alphanumeric sender ID (a name rather than a number) cannot receive
   * replies, which is right for one-time codes — nobody should be able to
   * reply to them — but it has to be registered with the operators in most
   * countries, Georgia included.
   */
  from: string;
  /** Overridable so the tests can drive it without touching the network. */
  fetchImpl?: typeof fetch;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  /** A real gateway never hands the code back. */
  readonly echoesCode = false;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: TwilioConfig) {
    if (!config.accountSid || !config.authToken || !config.from) {
      throw new Error(
        'Twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM to be set.',
      );
    }
    // Bound to the global rather than stored bare: calling it back as
    // `this.fetchImpl(...)` would hand fetch this object as its receiver, which
    // a browser refuses outright.
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      this.config.accountSid,
    )}/Messages.json`;

    const body = new URLSearchParams({
      To: message.to,
      From: this.config.from,
      Body: message.body,
    });

    // Basic auth with the account SID as the username, which is what Twilio's
    // REST API expects.
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString(
      'base64',
    );

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        // A code nobody receives within ten seconds has already failed the
        // customer waiting on the screen; better to say so than to hang.
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      return {
        provider: this.name,
        messageId: '',
        status: 'FAILED',
        failureCode: error instanceof Error ? error.name : 'NETWORK_ERROR',
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };

    if (!response.ok) {
      return {
        provider: this.name,
        messageId: '',
        status: 'FAILED',
        // Twilio's numeric code is the useful part in a support conversation;
        // 21211 is an invalid number, 21608 an unverified one on a trial.
        failureCode: payload.code ? String(payload.code) : String(response.status),
      };
    }

    // `queued` and `accepted` both mean Twilio has taken it. Delivery is
    // asynchronous and only a status webhook can confirm it, so accepting the
    // handover is as much as this call can honestly report.
    return {
      provider: this.name,
      messageId: payload.sid ?? '',
      status: 'SENT',
    };
  }
}

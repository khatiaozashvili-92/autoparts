import type { SmsMessage, SmsProvider, SmsResult } from './sms-provider.js';

/**
 * A configurable adapter for a plain HTTP SMS gateway.
 *
 * Georgian bulk-SMS aggregators almost all expose the same shape: one URL, a
 * few query parameters (an API key, the destination, the sender name, the
 * text) and a short body saying whether it was accepted. They differ only in
 * what those parameters are called.
 *
 * Writing one adapter per vendor would mean a code change and a deploy to
 * switch supplier, or to add a second one as a fallback. Instead the parameter
 * names are configuration, so onboarding a gateway is filling in environment
 * variables — the same principle the fitment and payment seams already follow
 * (docs/02 §7.1).
 *
 * The exact parameter names must come from the provider's own documentation.
 * Nothing here guesses them, because a wrong guess would fail silently at the
 * worst moment: in production, on a real customer's sign-in.
 */
export interface HttpSmsConfig {
  /** The endpoint, without query parameters. */
  url: string;
  method?: 'GET' | 'POST';
  /** Parameter name for the destination number, e.g. `destination` or `to`. */
  toParam: string;
  /** Parameter name for the message text, e.g. `content` or `text`. */
  textParam: string;
  /** Parameter name for the sender ID, when the gateway wants one. */
  senderParam?: string;
  sender?: string;
  /** Parameter name for the API key, when it travels in the query or body. */
  keyParam?: string;
  key?: string;
  /** For gateways that authenticate with a header instead. */
  authHeader?: string;
  /** Anything else the gateway requires, verbatim. */
  extraParams?: Record<string, string>;
  /**
   * How to tell success from failure in the response body.
   *
   * Many of these gateways answer 200 OK and put the real outcome in the body,
   * so HTTP status alone is not enough. When set, the body must match this for
   * the send to count as accepted.
   */
  successPattern?: string;
  /** Strip the leading '+' — several local gateways reject E.164 with it. */
  stripPlus?: boolean;
  fetchImpl?: typeof fetch;
}

export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  readonly echoesCode = false;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: HttpSmsConfig) {
    if (!config.url || !config.toParam || !config.textParam) {
      throw new Error(
        'The HTTP SMS gateway needs at least SMS_HTTP_URL, SMS_HTTP_TO_PARAM and SMS_HTTP_TEXT_PARAM.',
      );
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const to = this.config.stripPlus ? message.to.replace(/^\+/, '') : message.to;

    const params = new URLSearchParams({
      [this.config.toParam]: to,
      [this.config.textParam]: message.body,
      ...(this.config.senderParam && this.config.sender
        ? { [this.config.senderParam]: this.config.sender }
        : {}),
      ...(this.config.keyParam && this.config.key
        ? { [this.config.keyParam]: this.config.key }
        : {}),
      ...(this.config.extraParams ?? {}),
    });

    const method = this.config.method ?? 'GET';
    const url = method === 'GET' ? `${this.config.url}?${params}` : this.config.url;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          ...(this.config.authHeader ? { authorization: this.config.authHeader } : {}),
          ...(method === 'POST'
            ? { 'content-type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        ...(method === 'POST' ? { body: params } : {}),
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

    const text = await response.text().catch(() => '');

    if (!response.ok) {
      return {
        provider: this.name,
        messageId: '',
        status: 'FAILED',
        failureCode: String(response.status),
      };
    }

    // A 200 that says "insufficient balance" in the body is a failure, and
    // treating it as a send would leave a customer waiting for a code that was
    // never paid for.
    if (this.config.successPattern) {
      const matched = new RegExp(this.config.successPattern).test(text);
      if (!matched) {
        return {
          provider: this.name,
          messageId: '',
          status: 'FAILED',
          // The body is the only diagnostic these gateways give, so a short
          // slice of it goes into the log.
          failureCode: text.slice(0, 80) || 'UNRECOGNISED_RESPONSE',
        };
      }
    }

    return {
      provider: this.name,
      messageId: text.slice(0, 60).trim(),
      status: 'SENT',
    };
  }
}

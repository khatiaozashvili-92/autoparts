import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createSmsProvider } from './sms-provider.js';
import { TwilioSmsProvider } from './twilio.provider.js';
import { HttpSmsProvider } from './http.provider.js';

/**
 * These adapters cannot be tried against a real gateway from here, and the
 * first time they run for real will be a customer trying to sign in. So every
 * branch is driven against a fake `fetch`: what gets sent, and — more
 * importantly — that a refusal is reported as a refusal rather than swallowed.
 *
 * The failure that matters is the quiet one. A gateway answering 200 OK with
 * "insufficient balance" in the body, reported as sent, leaves somebody
 * staring at a code screen forever.
 */

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(handler(String(url), init));
  }) as typeof fetch;
  return { impl, calls };
}

/* ───────────────────────────── Twilio ───────────────────────────── */

test('twilio posts the message and reports the id it gets back', async () => {
  const { impl, calls } = fakeFetch(
    () =>
      new Response(JSON.stringify({ sid: 'SM123', status: 'queued' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
  );

  const provider = new TwilioSmsProvider({
    accountSid: 'AC_test',
    authToken: 'secret',
    from: 'autoparts',
    fetchImpl: impl,
  });

  const result = await provider.send({ to: '+995555123456', body: 'code 123456' });

  assert.equal(result.status, 'SENT');
  assert.equal(result.messageId, 'SM123');
  assert.equal(result.provider, 'twilio');

  const [call] = calls;
  assert.ok(call!.url.includes('/Accounts/AC_test/Messages.json'));
  assert.equal(call!.init.method, 'POST');

  const body = String(call!.init.body);
  assert.ok(body.includes('To=%2B995555123456'), 'the number travels in E.164');
  assert.ok(body.includes('From=autoparts'));

  const auth = (call!.init.headers as Record<string, string>)['authorization'];
  assert.equal(auth, `Basic ${Buffer.from('AC_test:secret').toString('base64')}`);
});

test('twilio reports a rejection rather than pretending it sent', async () => {
  const { impl } = fakeFetch(
    () =>
      new Response(JSON.stringify({ code: 21211, message: 'Invalid To number' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
  );

  const provider = new TwilioSmsProvider({
    accountSid: 'AC', authToken: 't', from: 'x', fetchImpl: impl,
  });
  const result = await provider.send({ to: '+9950', body: 'x' });

  assert.equal(result.status, 'FAILED');
  // The numeric code is what makes a support conversation short.
  assert.equal(result.failureCode, '21211');
});

test('twilio survives the network being down', async () => {
  const impl = (() => Promise.reject(new Error('connect ECONNREFUSED'))) as typeof fetch;
  const provider = new TwilioSmsProvider({
    accountSid: 'AC', authToken: 't', from: 'x', fetchImpl: impl,
  });
  const result = await provider.send({ to: '+995555123456', body: 'x' });
  // Reported, never thrown: the caller turns this into "the code could not be
  // sent, try again", which is the truth.
  assert.equal(result.status, 'FAILED');
});

test('twilio refuses to start without credentials', () => {
  assert.throws(
    () => new TwilioSmsProvider({ accountSid: '', authToken: '', from: '' }),
    /TWILIO_ACCOUNT_SID/,
  );
});

/* ─────────────────────── the configurable gateway ─────────────────────── */

test('the http gateway sends the parameter names it was configured with', async () => {
  const { impl, calls } = fakeFetch(() => new Response('OK: 42', { status: 200 }));

  const provider = new HttpSmsProvider({
    url: 'https://gateway.example/send',
    toParam: 'destination',
    textParam: 'content',
    senderParam: 'sender',
    sender: 'autoparts',
    keyParam: 'key',
    key: 'abc123',
    stripPlus: true,
    fetchImpl: impl,
  });

  const result = await provider.send({ to: '+995555123456', body: 'code' });
  assert.equal(result.status, 'SENT');

  const url = new URL(calls[0]!.url);
  // Several local gateways reject E.164 with the plus still on it.
  assert.equal(url.searchParams.get('destination'), '995555123456');
  assert.equal(url.searchParams.get('content'), 'code');
  assert.equal(url.searchParams.get('sender'), 'autoparts');
  assert.equal(url.searchParams.get('key'), 'abc123');
});

test('a 200 that actually says no counts as a failure', async () => {
  // The one that matters. These gateways answer 200 and put the real outcome
  // in the body; reporting that as sent leaves a customer waiting forever for
  // a code nobody paid for.
  const { impl } = fakeFetch(() => new Response('ERROR: insufficient balance', { status: 200 }));

  const provider = new HttpSmsProvider({
    url: 'https://gateway.example/send',
    toParam: 'to',
    textParam: 'text',
    successPattern: '^OK',
    fetchImpl: impl,
  });

  const result = await provider.send({ to: '+995555123456', body: 'code' });
  assert.equal(result.status, 'FAILED');
  assert.ok(result.failureCode?.includes('insufficient balance'));
});

test('the http gateway can POST when a provider wants that', async () => {
  const { impl, calls } = fakeFetch(() => new Response('OK', { status: 200 }));
  const provider = new HttpSmsProvider({
    url: 'https://gateway.example/send',
    method: 'POST',
    toParam: 'to',
    textParam: 'text',
    authHeader: 'Bearer tok',
    fetchImpl: impl,
  });

  await provider.send({ to: '+995555123456', body: 'code' });
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(String(calls[0]!.url), 'https://gateway.example/send');
  assert.ok(String(calls[0]!.init.body).includes('to=%2B995555123456'));
  assert.equal((calls[0]!.init.headers as Record<string, string>)['authorization'], 'Bearer tok');
});

/* ───────────────────────────── the factory ───────────────────────────── */

test('a real gateway never echoes the code back', () => {
  // The echo is what makes local development possible and is refused in
  // production; a real provider must not offer it at all.
  assert.equal(createSmsProvider('console').echoesCode, true);
  assert.equal(
    createSmsProvider('twilio', {
      twilio: { accountSid: 'a', authToken: 'b', from: 'c' },
    }).echoesCode,
    false,
  );
  assert.equal(
    createSmsProvider('http', {
      http: { url: 'https://x', toParam: 'to', textParam: 'text' },
    }).echoesCode,
    false,
  );
});

test('a misconfigured gateway fails at startup, not at the first sign-in', () => {
  assert.throws(() => createSmsProvider('twilio'), /TWILIO_ACCOUNT_SID/);
  assert.throws(() => createSmsProvider('http'), /SMS_HTTP_URL/);
  assert.throws(() => createSmsProvider('nonsense'), /Unknown SMS provider/);
});

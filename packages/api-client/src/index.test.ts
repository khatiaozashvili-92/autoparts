import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiClient } from './index.js';

/**
 * Regression tests for the transport itself.
 *
 * Everything here is about the one thing the end-to-end suites structurally
 * cannot see: they run in Node, and Node's `fetch` tolerates being called in
 * ways a browser rejects outright. A client that passes every suite and fails
 * on every real page is the failure mode these guard against.
 */

/**
 * Stands in for the browser's `fetch`, which throws
 * `TypeError: Illegal invocation` when called with a receiver that is not the
 * global object. Node's does not, which is exactly why this has to be faked.
 */
function browserLikeFetch(onCall: (url: string, init?: RequestInit) => Response) {
  return function (this: unknown, input: string | URL | Request, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(onCall(String(input), init));
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('the default fetch is not called with the client as its receiver', async () => {
  // The bug this exists for: `this.fetchImpl = fetch` then `this.fetchImpl(…)`
  // hands `fetch` the ApiClient as `this`. Node shrugs; every browser refuses,
  // so every request from the web and mobile apps failed before reaching the
  // network while the whole test suite stayed green.
  const original = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = browserLikeFetch((url) => {
    calledUrl = url;
    return jsonResponse({ challengeId: 'c1', expiresIn: 300, resendAfter: 60, maskedPhone: '' });
  }) as typeof fetch;

  try {
    // Constructed with no fetchImpl on purpose — the default path is the one
    // that broke, and the one both apps use.
    const client = new ApiClient({ baseUrl: 'http://localhost:3001' });
    const result = await client.requestOtp('555123456');
    assert.equal(result.challengeId, 'c1');
    assert.equal(calledUrl, 'http://localhost:3001/api/v1/auth/otp/request');
  } finally {
    globalThis.fetch = original;
  }
});

test('an injected fetch is used as given', async () => {
  let seen = '';
  const client = new ApiClient({
    baseUrl: 'http://localhost:3001',
    fetchImpl: ((url: string | URL | Request) => {
      seen = String(url);
      return Promise.resolve(jsonResponse({ id: 'u1', roles: [] }));
    }) as typeof fetch,
  });

  await client.me();
  assert.equal(seen, 'http://localhost:3001/api/v1/auth/me');
});

test('a trailing slash on the base URL does not double up in the path', async () => {
  let seen = '';
  const client = new ApiClient({
    baseUrl: 'http://localhost:3001/',
    fetchImpl: ((url: string | URL | Request) => {
      seen = String(url);
      return Promise.resolve(jsonResponse({ id: 'u1', roles: [] }));
    }) as typeof fetch,
  });

  await client.me();
  assert.equal(seen, 'http://localhost:3001/api/v1/auth/me');
});

test('an API error arrives with the messageKey the UI renders', async () => {
  // The clients never display the English `message` (PRD §80), so an error
  // that loses `messageKey` shows a customer a developer's sentence.
  const client = new ApiClient({
    baseUrl: 'http://localhost:3001',
    fetchImpl: (() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'A code was already sent.',
              messageKey: 'error.otp.resendTooSoon',
              details: { retryAfter: 42 },
            },
          },
          429,
        ),
      )) as typeof fetch,
  });

  await assert.rejects(
    () => client.requestOtp('555123456'),
    (error: { messageKey?: string; details?: Record<string, unknown> }) => {
      assert.equal(error.messageKey, 'error.otp.resendTooSoon');
      assert.equal(error.details?.['retryAfter'], 42);
      return true;
    },
  );
});

test('verifying a code stores the tokens it returns', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:3001',
    fetchImpl: (() =>
      Promise.resolve(
        jsonResponse({
          userId: 'u1',
          isNewUser: true,
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresIn: 900,
        }),
      )) as typeof fetch,
  });

  const result = await client.verifyOtp({ challengeId: 'c1', code: '123456' });
  assert.equal(result.isNewUser, true);
  // Without this the customer would be signed in and immediately anonymous
  // again on the next request.
  assert.equal(client.tokens.getAccessToken(), 'access-1');
  assert.equal(client.tokens.getRefreshToken(), 'refresh-1');
});

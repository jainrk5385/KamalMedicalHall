import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { ApiError } from '../src/core/errors/ApiError';
import { createHttpClient, type HttpClientDeps } from '../src/core/network/httpClient';

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number };
interface Call { url: string; method: string; headers: Record<string, string> }

/** A fake network: answers from a queue (or a function), records every call, honours abort. */
function fakeFetch(replies: Reply[] | ((call: Call, n: number) => Reply)) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string>) } };
    calls.push(call);
    const reply = typeof replies === 'function' ? replies(call, calls.length) : replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (reply.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, reply.delayMs);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
      });
    }
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'content-type': 'application/json', ...reply.headers } });
  }) as typeof fetch;
  return { impl, calls };
}

function client(replies: Reply[] | ((call: Call, n: number) => Reply), over: Partial<HttpClientDeps> = {}) {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  const events = { unauthorized: 0, refreshes: 0, slow: [] as boolean[] };
  const c = createHttpClient({
    baseUrl: 'https://api.example.com', fetchImpl: f.impl,
    getToken: async () => 'old-token',
    refreshToken: async () => { events.refreshes += 1; await new Promise((r) => setTimeout(r, 5)); return 'new-token'; },
    onUnauthorized: () => { events.unauthorized += 1; },
    onSlowChange: (s) => events.slow.push(s),
    sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, makeId: () => 'req-test-0001',
    ...over,
  });
  return { c, ...f, sleeps, events };
}

describe('http client', () => {
  it('sends the bearer token and a request id, and never puts the token in the URL', async () => {
    const { c, calls } = client([{ status: 200, body: { ok: true } }]);
    await c.request('GET', '/me');
    assert.equal(calls[0]!.headers.Authorization, 'Bearer old-token');
    assert.equal(calls[0]!.headers['X-Request-Id'], 'req-test-0001');
    assert.doesNotMatch(calls[0]!.url, /token/i);
    const anon = client([{ status: 200 }]);
    await anon.c.request('GET', '/config', undefined, { auth: false });
    assert.equal(anon.calls[0]!.headers.Authorization, undefined);
  });

  it('shares one request between identical simultaneous GETs, but never merges writes', async () => {
    const { c, calls } = client([{ status: 200, body: { n: 1 }, delayMs: 20 }]);
    const [a, b, d] = await Promise.all([c.request('GET', '/orders?scope=active'), c.request('GET', '/orders?scope=active'), c.request('GET', '/orders?scope=active')]);
    assert.equal(calls.length, 1);
    assert.deepEqual(a, b); assert.deepEqual(b, d);
    await c.request('GET', '/orders?scope=active'); // finished before, so this one goes out again
    assert.equal(calls.length, 2);
    await Promise.all([c.request('POST', '/chat/messages', { body: 'x' }), c.request('POST', '/chat/messages', { body: 'x' })]);
    assert.equal(calls.length, 4, 'two POSTs are two requests');
    await Promise.all([c.request('GET', '/orders?scope=active'), c.request('GET', '/orders?scope=cancelled')]);
    assert.equal(calls.length, 6, 'different URLs are different requests');
  });

  it('retries a GET after 503 with backoff and jitter, then succeeds', async () => {
    const { c, calls, sleeps } = client([{ status: 503 }, { status: 502 }, { status: 200, body: { ok: 1 } }]);
    assert.deepEqual(await c.request('GET', '/pincodes'), { ok: 1 });
    assert.equal(calls.length, 3);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps[0]! >= 150 && sleeps[0]! <= 300, `first backoff ${sleeps[0]}`);
    assert.ok(sleeps[1]! > sleeps[0]!, 'backoff grows');
  });

  it('gives up after two retries with a safe message that hides server details', async () => {
    const { c, calls } = client([{ status: 500, body: { error: { code: 'internal', message: 'SELECT * FROM users failed at /srv/app/db.ts', requestId: 'srv-1' } } }]);
    await assert.rejects(c.request('GET', '/orders'), (e: ApiError) => e.status === 500 && !/SELECT|srv\/app/.test(e.message) && e.requestId === 'srv-1');
    assert.equal(calls.length, 1, '500 is not a retryable status');
    const flaky = client([{ status: 503 }]);
    await assert.rejects(flaky.c.request('GET', '/orders'), (e: ApiError) => e.isServer);
    assert.equal(flaky.calls.length, 3);
  });

  it('never retries a write unless the caller says it is safe', async () => {
    const unsafe = client([{ status: 503 }, { status: 200 }]);
    await assert.rejects(unsafe.c.request('POST', '/orders/1/accept-quote', { paymentMethod: 'cod' }));
    assert.equal(unsafe.calls.length, 1, 'a payment request is sent once');
    const idem = client([{ status: 503 }, { status: 200, body: { order: 1 } }]);
    assert.deepEqual(await idem.c.request('POST', '/orders', { idempotencyKey: 'k' }, { retry: 'always' }), { order: 1 });
    assert.equal(idem.calls.length, 2, 'an idempotent create may be repeated');
  });

  it('keeps the server message for expected client errors and maps 429', async () => {
    const bad = client([{ status: 409, body: { error: { code: 'slot_unavailable', message: 'That delivery time is no longer available.' } } }]);
    await assert.rejects(bad.c.request('POST', '/orders', {}), (e: ApiError) => e.code === 'slot_unavailable' && /no longer available/.test(e.message));
    const limited = client([{ status: 429, headers: { 'retry-after': '1' } }, { status: 200, body: { ok: 1 } }]);
    assert.deepEqual(await limited.c.request('GET', '/me'), { ok: 1 });
    assert.deepEqual(limited.sleeps, [1000], 'honours Retry-After');
  });

  it('shows a phone verification message for OTP server errors without exposing internals', async () => {
    const { c } = client([{ status: 502, body: { error: { code: 'otp_unavailable', message: 'PearlSMS key rejected: secret-detail' } } }]);
    await assert.rejects(c.request('POST', '/auth/otp/send', { phone: '9000000000' }, { auth: false, retry: 'never' }), (e: ApiError) => {
      assert.equal(e.code, 'otp_unavailable');
      assert.match(e.message, /Phone verification is temporarily unavailable/);
      assert.doesNotMatch(e.message, /PearlSMS|secret-detail/);
      return true;
    });
    const internal = client([{ status: 500, body: { error: { code: 'internal', message: 'MongoDB connection string leaked' } } }]);
    await assert.rejects(internal.c.request('POST', '/auth/otp/send', {}, { auth: false, retry: 'never' }), (e: ApiError) => e.status === 500 && /Phone verification is temporarily unavailable/.test(e.message) && !/MongoDB/.test(e.message));
  });

  it('refreshes the token once for many simultaneous 401s, then retries each request', async () => {
    const { c, calls, events } = client((call) => (call.headers.Authorization === 'Bearer new-token' ? { status: 200, body: { ok: true } } : { status: 401, body: { error: { code: 'invalid_token', message: 'expired' } } }));
    const results = await Promise.all([c.request('GET', '/a'), c.request('GET', '/b'), c.request('POST', '/c', {}), c.request('GET', '/d'), c.request('GET', '/e')]);
    assert.equal(results.length, 5);
    assert.equal(events.refreshes, 1, 'single-flight refresh');
    assert.equal(events.unauthorized, 0);
    assert.equal(calls.filter((x) => x.headers.Authorization === 'Bearer new-token').length, 5);
    assert.equal(calls.length, 10, 'each request is sent twice at most (old token, then new token)');
  });

  it('signs the user out only when the session cannot be renewed', async () => {
    const { c, events } = client([{ status: 401, body: { error: { code: 'invalid_token', message: 'Your session has expired.' } } }], { refreshToken: async () => null });
    await assert.rejects(c.request('GET', '/me'), (e: ApiError) => e.isAuth);
    assert.equal(events.unauthorized, 1);
    // a 401 on a call that carries its own token (first call after sign-in) never triggers a refresh or sign-out
    const first = client([{ status: 401 }]);
    await assert.rejects(first.c.request('POST', '/auth/session', undefined, { token: 'fresh' }));
    assert.equal(first.events.refreshes, 0); assert.equal(first.events.unauthorized, 0);
  });

  it('times out slow requests with a clear error and no hung spinner', async () => {
    const { c } = client([{ status: 200, delayMs: 500 }]);
    await assert.rejects(c.request('POST', '/slow', {}, { timeoutMs: 30 }), (e: ApiError) => e.isNetwork && e.code === 'timeout' && /taking too long/.test(e.message));
  });

  it('lets a screen cancel its request', async () => {
    const { c } = client([{ status: 200, delayMs: 500 }]);
    const ctl = new AbortController();
    const p = c.request('GET', '/orders', undefined, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 10);
    await assert.rejects(p, (e: ApiError) => e.code === 'aborted');
  });

  it('retries a dropped connection for GET but not for a write', async () => {
    let n = 0;
    const impl = (async () => { n += 1; if (n < 3) throw new TypeError('network down'); return new Response('{"ok":1}', { status: 200 }); }) as typeof fetch;
    const { c } = client([], { fetchImpl: impl });
    assert.deepEqual(await c.request('GET', '/me'), { ok: 1 });
    assert.equal(n, 3);
    let m = 0;
    const down = (async () => { m += 1; throw new TypeError('network down'); }) as typeof fetch;
    const w = client([], { fetchImpl: down });
    await assert.rejects(w.c.request('POST', '/chat/messages', {}), (e: ApiError) => e.isNetwork);
    assert.equal(m, 1);
  });

  it('rejects a response that does not match the expected shape', async () => {
    const schema = z.object({ user: z.object({ id: z.string() }) });
    const { c } = client([{ status: 200, body: { user: { id: 42 } } }]);
    await assert.rejects(c.request('GET', '/me', undefined, { schema }), (e: ApiError) => e.code === 'bad_response');
    const ok = client([{ status: 200, body: { user: { id: 'u1' } } }]);
    assert.deepEqual(await ok.c.request('GET', '/me', undefined, { schema }), { user: { id: 'u1' } });
  });

  it('reports a slow server (for the "waking up" message) and clears it afterwards', async () => {
    const { c, events } = client([{ status: 200, delayMs: 80 }], { slowAfterMs: 20 });
    await c.request('GET', '/config');
    assert.deepEqual(events.slow, [true, false], 'slow while waiting, cleared when the answer arrives');
    const fast = client([{ status: 200 }], { slowAfterMs: 20 });
    await fast.c.request('GET', '/config');
    assert.deepEqual(fast.events.slow, [], 'a fast request never shows the message');
  });
});

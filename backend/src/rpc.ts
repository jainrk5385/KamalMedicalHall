import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'socket.io';

/**
 * Request/response over the socket.
 *
 * The app sends `rpc` messages { m: method, p: path, b: body, a: "Bearer <token>", id: request id } and gets
 * { s: status, b: body, h: a few headers } back through the acknowledgement. Each message is replayed against this same
 * server over the loopback interface, so it goes through the very same Express application (routes, validation,
 * authentication, rate limits, logging) as an ordinary HTTP request: there is one implementation of every endpoint and
 * the token is checked on every single call, not once per connection. The loopback hop costs about a millisecond and
 * never leaves the machine.
 */
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Things that are not JSON conversations: provider webhooks, file downloads and the socket transport itself. */
const NOT_OVER_SOCKET = [/^\/webhooks(\/|\?|$)/, /^\/export(\/|\?|$)/, /\/invoice\.pdf(\?|$)/, /^\/socket\.io/];

/** Proves a request came from this process (the socket handler), not from outside. Changes on every start. */
export const INTERNAL_HEADER = 'x-kmh-rpc';
export const INTERNAL_SECRET = randomBytes(24).toString('hex');

const BUCKET_SIZE = 60;           // a burst of 60 calls...
const BUCKET_REFILL_MS = 10_000;  // ...refilled over 10 seconds
const MAX_REPLY_BYTES = 5_000_000;

interface RpcMessage { m: string; p: string; b?: unknown; a?: string; id?: string }
const isMessage = (v: unknown): v is RpcMessage => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.m === 'string' && typeof r.p === 'string' && (r.a === undefined || typeof r.a === 'string') && (r.id === undefined || typeof r.id === 'string');
};

const clientIp = (socket: Socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || socket.handshake.address || '127.0.0.1';
};

const firstHeader = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();

/** Match the loopback address family to the address family used by the listener. */
export function loopbackHostFor(address: Pick<AddressInfo, 'family'>): string {
  return address.family === 'IPv6' ? '::1' : '127.0.0.1';
}

/**
 * The address the app reached us on, so links the API builds from the request (invoice PDF, CSV exports) point at the
 * public server and not at the loopback hop (127.0.0.1), which a phone cannot open.
 */
const publicOrigin = (socket: Socket): Record<string, string> => {
  const h = socket.handshake.headers;
  const host = firstHeader(h['x-forwarded-host']) || firstHeader(h.host);
  const proto = firstHeader(h['x-forwarded-proto']) || (socket.handshake.secure ? 'https' : 'http');
  return {
    ...(host && /^[\w.-]+(:\d{1,5})?$/.test(host) ? { host } : {}),
    ...(proto === 'https' || proto === 'http' ? { 'x-forwarded-proto': proto } : {}),
  };
};

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

interface LoopbackReply { status: number; headers: http.IncomingHttpHeaders; text: string }
function loopback(server: http.Server, method: string, path: string, headers: Record<string, string>, payload?: string): Promise<LoopbackReply> {
  return new Promise((resolve, reject) => {
    const address = server.address() as AddressInfo | null;
    if (!address || typeof address === 'string') return reject(new Error('server is not listening'));
    const req = http.request({ host: loopbackHostFor(address), port: address.port, method, path, headers, agent, timeout: 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_REPLY_BYTES) req.destroy(new Error('reply too large')); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 500, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export function attachRpc(socket: Socket, server: http.Server) {
  let tokens = BUCKET_SIZE;
  let last = Date.now();

  socket.on('rpc', async (msg: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    const reply = (s: number, b: unknown, h: Record<string, string> = {}) => { (ack as (r: unknown) => void)({ s, b, h }); };
    const error = (s: number, code: string, message: string, h?: Record<string, string>) => reply(s, { error: { code, message } }, h);

    const now = Date.now();
    tokens = Math.min(BUCKET_SIZE, tokens + ((now - last) / BUCKET_REFILL_MS) * BUCKET_SIZE);
    last = now;
    if (tokens < 1) return error(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { 'retry-after': '2' });
    tokens -= 1;

    if (!isMessage(msg)) return error(400, 'bad_request', 'Invalid request.');
    const method = msg.m.toUpperCase();
    if (!METHODS.has(method) || !msg.p.startsWith('/') || msg.p.startsWith('//') || msg.p.length > 2000 || /[\r\n\s]/.test(msg.p)) return error(400, 'bad_request', 'Invalid request.');
    if (NOT_OVER_SOCKET.some((rx) => rx.test(msg.p))) return error(404, 'not_found', 'Not found');
    if (msg.a !== undefined && (msg.a.length > 4000 || !/^Bearer [\w.~+/=-]+$/.test(msg.a))) return error(400, 'bad_request', 'Invalid request.');

    const payload = msg.b === undefined || method === 'GET' ? undefined : JSON.stringify(msg.b);
    if (payload && payload.length > 100_000) return error(413, 'too_large', 'That request is too large.');

    try {
      const res = await loopback(server, method, msg.p, {
        [INTERNAL_HEADER]: INTERNAL_SECRET,
        'x-forwarded-for': clientIp(socket),
        ...publicOrigin(socket),
        'accept-encoding': 'identity',
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
        ...(msg.a ? { authorization: msg.a } : {}),
        ...(msg.id && /^[\w-]{8,64}$/.test(msg.id) ? { 'x-request-id': msg.id } : {}),
      }, payload);
      let body: unknown = null;
      if (res.status !== 204 && res.text) { try { body = JSON.parse(res.text); } catch { body = null; } }
      const h: Record<string, string> = {};
      for (const k of ['retry-after', 'x-request-id', 'server-timing']) { const v = res.headers[k]; if (typeof v === 'string') h[k] = v; }
      reply(res.status, body, h);
    } catch (cause) {
      const requestId = msg.id && /^[\w-]{8,64}$/.test(msg.id) ? msg.id : undefined;
      console.error(JSON.stringify({
        level: 'error',
        msg: 'rpc_loopback_failed',
        ...(requestId ? { id: requestId } : {}),
        error: cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause),
      }));
      reply(500, {
        error: {
          code: 'internal',
          message: 'Something went wrong. Please try again.',
          ...(requestId ? { requestId } : {}),
        },
      }, requestId ? { 'x-request-id': requestId } : {});
    }
  });
}

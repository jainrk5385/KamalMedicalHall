import type { ZodType } from 'zod';
import { ApiError, GENERIC_MESSAGES } from '../errors/ApiError';
import type { Logger } from '../logging/logger';

/**
 * The one place that talks HTTP. It owns the request lifecycle so screens never have to:
 *  - separate timeout policies (normal / upload),
 *  - de-duplication of identical in-flight GETs (focus + effect + pull-to-refresh become one request),
 *  - retries with exponential backoff and jitter, for safe (idempotent) requests only,
 *  - a single-flight token refresh: many simultaneous 401s trigger exactly one refresh,
 *  - safe error messages (server internals never reach the screen),
 *  - optional runtime validation of responses,
 *  - a "slow" signal so the UI can say "the server is waking up" instead of spinning silently.
 * It has no React Native imports, so it is unit-tested with a fake `fetch`.
 */
export type RetryPolicy = 'safe' | 'always' | 'never';
export interface RequestOptions<T = unknown> {
  /** Send the bearer token (default true). */
  auth?: boolean;
  /** Use this token instead of the stored one (first call after sign-in). */
  token?: string;
  /** Overrides the timeout for this call. */
  timeoutMs?: number;
  /** 'safe' (default): retry GET only. 'always': also retry writes (only when the call carries an idempotency key). 'never'. */
  retry?: RetryPolicy;
  /** Share the in-flight request with identical callers. Default: true for GET. */
  dedupe?: boolean;
  /** Runtime check of the response body. A mismatch becomes an "unexpected response" error. */
  schema?: ZodType<T>;
  /** Lets the caller cancel (e.g. when a screen unmounts). */
  signal?: AbortSignal;
}

export interface HttpClientDeps {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
  /** Returns a freshly issued token, or null when the session cannot be renewed. */
  refreshToken: () => Promise<string | null>;
  onUnauthorized: () => void;
  onSlowChange?: (slow: boolean) => void;
  /** How long a request may wait before the UI is told the server is slow (default 6 s). */
  slowAfterMs?: number;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  makeId?: () => string;
}

export const TIMEOUTS = { requestMs: 15_000, uploadMs: 120_000, slowAfterMs: 6_000 } as const;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;

export function createHttpClient(deps: HttpClientDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const makeId = deps.makeId ?? (() => `${Date.now().toString(36)}-${Math.floor(random() * 0xffffffff).toString(16).padStart(8, '0')}`);
  const inflight = new Map<string, Promise<unknown>>();
  let refreshing: Promise<string | null> | null = null;
  let pending = 0;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let slow = false;

  const setSlow = (v: boolean) => { if (slow !== v) { slow = v; deps.onSlowChange?.(v); } };
  const begin = () => {
    pending += 1;
    if (!slowTimer) slowTimer = setTimeout(() => { slowTimer = null; if (pending > 0) setSlow(true); }, deps.slowAfterMs ?? TIMEOUTS.slowAfterMs);
  };
  const end = () => {
    pending = Math.max(0, pending - 1);
    if (pending === 0) { if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; } setSlow(false); }
  };

  /** One refresh at a time, shared by everyone who got a 401 meanwhile. */
  const refreshOnce = () => {
    refreshing ??= deps.refreshToken().catch(() => null).finally(() => { refreshing = null; });
    return refreshing;
  };

  const backoff = (attempt: number, retryAfterMs?: number) => {
    const exp = Math.min(2000, 300 * 2 ** attempt);
    return retryAfterMs !== undefined ? Math.min(retryAfterMs, 3000) : Math.round(exp * (0.5 + random() * 0.5));
  };

  async function attempt<T>(method: string, path: string, body: unknown, opts: RequestOptions<T>, token: string | null, requestId: string): Promise<{ status: number; data: unknown; retryAfterMs?: number }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? TIMEOUTS.requestMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetchImpl(`${deps.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const retryAfter = Number(res.headers.get('retry-after'));
      const data = res.status === 204 ? undefined : await res.json().catch(() => null);
      return { status: res.status, data, retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined };
    } catch (e) {
      if (opts.signal?.aborted) throw new ApiError(0, 'aborted', 'Request cancelled.', requestId);
      throw new ApiError(0, timedOut ? 'timeout' : 'network', timedOut ? GENERIC_MESSAGES.timeout : GENERIC_MESSAGES.network, requestId);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function run<T>(method: string, path: string, body: unknown, opts: RequestOptions<T>): Promise<T> {
    const requestId = makeId();
    const wantsAuth = opts.auth !== false;
    const policy: RetryPolicy = opts.retry ?? 'safe';
    const mayRetry = policy === 'always' || (policy === 'safe' && method === 'GET');
    let token = opts.token ?? (wantsAuth ? await deps.getToken() : null);
    let refreshed = false;
    let lastError: ApiError | null = null;

    for (let tries = 0; tries <= (mayRetry ? MAX_RETRIES : 0); tries++) {
      let r: Awaited<ReturnType<typeof attempt>>;
      try {
        r = await attempt(method, path, body, opts, token, requestId);
      } catch (e) {
        lastError = e as ApiError;
        if (lastError.code === 'aborted' || tries >= (mayRetry ? MAX_RETRIES : 0)) throw lastError;
        deps.logger?.debug('retrying after network error', { route: `${method} ${path.split('?')[0]}`, tries });
        await sleep(backoff(tries));
        continue;
      }

      if (r.status === 401 && wantsAuth && !opts.token) {
        // Not processed by the server, so retrying once with a renewed token is safe for every method.
        if (!refreshed) {
          refreshed = true;
          const fresh = await refreshOnce();
          if (fresh && fresh !== token) { token = fresh; tries -= 1; continue; }
        }
        deps.onUnauthorized();
      }

      if (r.status >= 200 && r.status < 300) {
        if (opts.schema) {
          const parsed = opts.schema.safeParse(r.data);
          if (!parsed.success) {
            deps.logger?.warn('response did not match its schema', { route: `${method} ${path.split('?')[0]}`, issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`) });
            throw new ApiError(502, 'bad_response', GENERIC_MESSAGES.badResponse, requestId);
          }
          return parsed.data;
        }
        return r.data as T;
      }

      if (mayRetry && RETRY_STATUSES.has(r.status) && tries < MAX_RETRIES) {
        deps.logger?.debug('retrying after server status', { route: `${method} ${path.split('?')[0]}`, status: r.status, tries });
        await sleep(backoff(tries, r.status === 429 ? r.retryAfterMs : undefined));
        continue;
      }

      if (r.status >= 500) deps.logger?.error('server error', { route: `${method} ${path.split('?')[0]}`, status: r.status, requestId });
      const err = (r.data as { error?: { code?: string; message?: string; requestId?: string } } | null)?.error;
      // Server messages are shown for expected (4xx) problems only; for 5xx the details stay in the server logs.
      const isOtpRequest = path.startsWith('/auth/otp/');
      const message = r.status >= 500
        ? (isOtpRequest ? GENERIC_MESSAGES.otpUnavailable : GENERIC_MESSAGES.server)
        : r.status === 429 ? GENERIC_MESSAGES.rateLimited : (typeof err?.message === 'string' && err.message ? err.message : GENERIC_MESSAGES.generic);
      throw new ApiError(r.status, err?.code ?? 'error', message, err?.requestId ?? requestId);
    }
    throw lastError ?? new ApiError(0, 'network', GENERIC_MESSAGES.network, requestId);
  }

  async function request<T = unknown>(method: string, path: string, body?: unknown, opts: RequestOptions<T> = {}): Promise<T> {
    // A caller that can cancel must not share (and so cancel) somebody else's request.
    const dedupe = (opts.dedupe ?? method === 'GET') && !opts.signal;
    const exec = async () => { begin(); try { return await run<T>(method, path, body, opts); } finally { end(); } };
    if (!dedupe) return exec();
    const key = `${method} ${path} ${opts.token ?? (opts.auth === false ? '-' : 'a')}`;
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = exec().finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  return { request, TIMEOUTS };
}
export type HttpClient = ReturnType<typeof createHttpClient>;

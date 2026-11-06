import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';
import { INTERNAL_HEADER, INTERNAL_SECRET } from './rpc.js';

/**
 * Browsers may only call the API from the origins in CORS_ORIGINS (the web admin). Native apps send no Origin header
 * and are always allowed: CORS protects browsers, not the API, which authenticates every request with a bearer token.
 * Outside production, localhost origins are allowed for development.
 */
export const isOriginAllowed = (origin: string | undefined) => {
  if (!origin) return true;
  if (config.corsOrigins.includes(origin.replace(/\/$/, ''))) return true;
  return !config.isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};
export const corsOptions: CorsOptions = {
  origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'Server-Timing'],
  maxAge: 600,
};
export const corsMiddleware = cors(corsOptions);

/** Limits are per signed-in user (a hash of the bearer token); anonymous calls are limited per IP. */
const keyOf = (req: Request) => {
  const auth = req.headers.authorization;
  return auth ? 'u:' + createHash('sha256').update(auth).digest('hex').slice(0, 24) : 'ip:' + ipKeyGenerator(req.ip ?? '0.0.0.0');
};
const limiter = (limit: number, windowMs = 60_000) => rateLimit({
  windowMs, limit, keyGenerator: keyOf, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.', requestId: res.locals.requestId } }); },
});
/** Everything. Generous, so busy screens and realtime refreshes are never affected. */
export const generalLimit = limiter(300);
/** Actions that cost money or send messages to other people. */
export const writeLimit = limiter(30);
export const uploadSignLimit = limiter(30);

/**
 * With API_TRANSPORT=socket the JSON API refuses ordinary HTTP calls. Allowed over HTTP: the health check, provider
 * webhooks, and the token-protected download links (invoice PDF, CSV exports), which a browser has to open. Requests
 * made by the socket handler inside this process carry a secret header and are always let through.
 */
const HTTP_ALLOWED = [
  /^\/health$/,
  /^\/webhooks\//,
  /^\/export\//,
  /^\/orders\/(?:[0-9a-f]{24}|[0-9a-f-]{36})\/invoice\.pdf$/i,
];
export function httpGate(req: Request, res: Response, next: NextFunction) {
  if (req.get(INTERNAL_HEADER) === INTERNAL_SECRET || !config.socketOnly) return next();
  if (req.method === 'OPTIONS' || HTTP_ALLOWED.some((rx) => rx.test(req.path))) return next();
  res.status(426).json({ error: { code: 'socket_only', message: 'Please update the app to continue.', requestId: res.locals.requestId } });
}

/**
 * Cache policy. Public store data may be reused for a few seconds (and revalidated with its ETag); everything else
 * carries personal or live data and must never be stored by a proxy or the HTTP cache.
 */
const PUBLIC_CACHEABLE = new Set(['/config', '/pincodes', '/terms']);
export function cachePolicy(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', req.method === 'GET' && PUBLIC_CACHEABLE.has(req.path) ? 'public, max-age=15, stale-while-revalidate=60' : 'no-store');
  next();
}

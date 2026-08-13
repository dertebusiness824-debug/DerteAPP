import config from '../config.js';
import { tooManyRequests } from '../lib/errors.js';

/**
 * Small in-process fixed-window limiter. It is deliberately dependency-free and
 * good enough for a single-node deployment; put a shared store (Redis) behind
 * `hit()` if DerteApp is ever scaled horizontally.
 */
const buckets = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
};

const timer = setInterval(sweep, 60_000);
timer.unref?.();

export function hit(key, { limit, windowMs }) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, remaining: Math.max(limit - entry.count, 0), resetAt: entry.resetAt };
}

export function rateLimit({ name, limit = 60, windowMs = 60_000, keyFn, message } = {}) {
  if (config.rateLimit.disabled) return (_req, _res, next) => next();

  return (req, res, next) => {
    // /api/webhooks/* must never be rate-limited — Retell reports "Queue is full."
    // when deliveries get 429/400 or stall. No express-rate-limit / bull / p-queue here.
    const path = String(req.originalUrl || req.url || '');
    if (path.includes('/webhooks/') || path.endsWith('/webhooks')) return next();

    const identity = keyFn ? keyFn(req) : req.clientIp ?? req.ip;
    const result = hit(`${name}:${identity}`, { limit, windowMs });
    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.set('Retry-After', String(Math.ceil((result.resetAt - Date.now()) / 1000)));
      return next(tooManyRequests(message ?? 'Too many requests, please slow down.'));
    }
    return next();
  };
}

export const resetRateLimits = () => buckets.clear();

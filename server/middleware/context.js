import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Resolves the caller IP behind a proxy and derives a rotating hash of it.
 * Analytics stores only the hash, so unique-visitor counts work without keeping
 * personal data.
 */
export function requestContext(req, _res, next) {
  const forwarded = req.get('x-forwarded-for');
  req.clientIp = (forwarded ? forwarded.split(',')[0].trim() : null) || req.ip || req.socket?.remoteAddress || '0.0.0.0';
  req.clientIpHash = crypto
    .createHash('sha256')
    .update(`${req.clientIp}|${config.auth.jwtSecret}|${new Date().toISOString().slice(0, 10)}`)
    .digest('hex')
    .slice(0, 32);
  next();
}

export function deviceFromUserAgent(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  if (!ua) return 'unknown';
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|android.+mobile|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

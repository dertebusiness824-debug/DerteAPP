import config from '../config.js';
import { queryOne } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { listAccessibleShops, resolveSession } from '../services/auth.js';

/** Bearer header first (API clients, embed), then the httpOnly session cookie. */
function readToken(req) {
  const header = req.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.cookies?.[config.auth.cookieName] ?? null;
}

/** Populates req.user when a valid session exists; never rejects. */
export const attachUser = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (token) {
    const session = await resolveSession(token);
    if (session) {
      req.user = session.user;
      req.sessionToken = token;
    }
  }
  next();
});

export const requireAuth = (req, _res, next) => {
  if (!req.user) return next(unauthorized('Please sign in to continue'));
  return next();
};

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized('Please sign in to continue'));
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Your role does not have access to this area', { code: 'role_forbidden' }));
    }
    return next();
  };

export const requireSuperAdmin = requireRole('super_admin');

const shopIdFrom = (req) =>
  req.params.shopId ?? req.params.shop_id ?? req.query.shop_id ?? req.body?.shop_id ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the tenant for the request and enforces membership.
 * Super Admins can address any shop (this is what powers the shop switcher);
 * shop owners are restricted to shops they belong to. When no shop is given,
 * an owner falls back to their primary shop.
 */
export const requireShopAccess = asyncHandler(async (req, _res, next) => {
  if (!req.user) return next(unauthorized('Please sign in to continue'));

  let shopId = shopIdFrom(req);

  if (!shopId) {
    if (req.user.role === 'super_admin') {
      return next(badRequest('shop_id is required for Super Admin requests', { code: 'shop_id_required' }));
    }
    const shops = await listAccessibleShops(req.user);
    if (shops.length === 0) return next(forbidden('Your account is not linked to a shop yet'));
    shopId = shops[0].id;
  }

  if (!UUID.test(String(shopId))) return next(badRequest('shop_id must be a valid identifier'));

  const shop = await queryOne('SELECT * FROM shops WHERE id = $1', [shopId]);
  if (!shop) return next(notFound('Shop not found'));

  if (req.user.role !== 'super_admin') {
    const membership = await queryOne('SELECT role FROM shop_members WHERE shop_id = $1 AND user_id = $2', [
      shop.id,
      req.user.id,
    ]);
    if (!membership) return next(forbidden('You do not have access to this shop', { code: 'shop_forbidden' }));
    if (shop.status !== 'active') return next(forbidden('This shop is suspended. Contact DerteApp support.'));
    req.shopRole = membership.role;
  } else {
    req.shopRole = 'super_admin';
  }

  req.shop = shop;
  return next();
});

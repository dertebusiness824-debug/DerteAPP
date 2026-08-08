/**
 * Sync helpers: keep Supabase (`shops` / Auth `profiles`) aligned with the
 * primary Express+pg data path when SUPABASE_SERVICE_ROLE_KEY is configured.
 *
 * Failures are logged and never break the local booking/auth write path —
 * Supabase may be unreachable from some environments (DNS/egress).
 */
import config from '../config.js';
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabase.js';

function log(op, error) {
  const message = error?.message || String(error);
  console.warn(`[supabase-sync] ${op}: ${message}`);
}

export function supabaseSyncEnabled() {
  return Boolean(config.supabase.adminConfigured && isSupabaseConfigured());
}

/** Upsert a shop row into Supabase (same UUID as local `shops.id`). */
export async function syncShopToSupabase(shop, extra = {}) {
  if (!supabaseSyncEnabled() || !shop?.id) return { ok: false, skipped: true };
  try {
    const sb = getSupabaseAdmin();
    const row = {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      public_key: shop.public_key,
      site_domains: shop.site_domains ?? [],
      site_url: shop.site_url ?? null,
      website_url: shop.website_url ?? null,
      phone: shop.phone ?? null,
      whatsapp_phone: shop.whatsapp_phone ?? null,
      email: shop.email ?? null,
      address: shop.address ?? null,
      city: shop.city ?? null,
      country_code: shop.country_code ?? null,
      timezone: shop.timezone ?? 'Europe/Madrid',
      status: shop.status ?? 'active',
      ...extra,
    };
    const { error } = await sb.from('shops').upsert(row, { onConflict: 'id' });
    if (error) {
      log('syncShop', error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (error) {
    log('syncShop', error);
    return { ok: false, error };
  }
}

/**
 * Persist Google Calendar OAuth tokens on Supabase `shops`.
 * Ensures the shop row exists first (upsert), then patches token columns.
 */
export async function syncGoogleCalendarTokensToSupabase(shopId, tokens = {}) {
  if (!supabaseSyncEnabled() || !shopId) return { ok: false, skipped: true };
  try {
    const sb = getSupabaseAdmin();
    const patch = {};
    if ('calendar_id' in tokens) patch.google_calendar_id = tokens.calendar_id;
    if ('refresh_token' in tokens) patch.google_calendar_refresh_token = tokens.refresh_token;
    if ('access_token' in tokens) patch.google_calendar_access_token = tokens.access_token;
    if ('token_expiry' in tokens) patch.google_calendar_token_expiry = tokens.token_expiry;
    if ('connected_email' in tokens) patch.google_calendar_connected_email = tokens.connected_email;
    if ('sync_enabled' in tokens) patch.google_calendar_sync_enabled = Boolean(tokens.sync_enabled);
    if (Object.keys(patch).length === 0) return { ok: true, skipped: true };

    const { error } = await sb.from('shops').update(patch).eq('id', shopId);
    if (error) {
      log('syncGoogleCalendarTokens', error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (error) {
    log('syncGoogleCalendarTokens', error);
    return { ok: false, error };
  }
}

/** Clear Google OAuth tokens on Supabase (disconnect). */
export async function clearGoogleCalendarTokensOnSupabase(shopId) {
  return syncGoogleCalendarTokensToSupabase(shopId, {
    refresh_token: null,
    access_token: null,
    token_expiry: null,
    connected_email: null,
    sync_enabled: false,
  });
}

/**
 * Register the owner in Supabase Auth (creates `profiles` via trigger) and
 * link them to the shop in `shop_members`.
 */
export async function syncOwnerToSupabase({ user, password, shop }) {
  if (!supabaseSyncEnabled() || !user?.email || !shop?.id) return { ok: false, skipped: true };
  try {
    const sb = getSupabaseAdmin();

    await syncShopToSupabase(shop);

    let authUserId = null;
    const { data: listed, error: listError } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (!listError) {
      const existing = (listed?.users ?? []).find(
        (entry) => entry.email?.toLowerCase() === String(user.email).toLowerCase(),
      );
      authUserId = existing?.id ?? null;
    }

    if (!authUserId) {
      const { data, error } = await sb.auth.admin.createUser({
        email: user.email,
        password: password || undefined,
        email_confirm: true,
        user_metadata: {
          full_name: user.full_name,
          phone: user.phone,
          role: user.role || 'shop_owner',
          local_user_id: user.id,
        },
      });
      if (error) {
        // Already registered — look up by email via generate link / list fallback.
        log('createUser', error);
        const retry = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
        authUserId =
          (retry.data?.users ?? []).find(
            (entry) => entry.email?.toLowerCase() === String(user.email).toLowerCase(),
          )?.id ?? null;
        if (!authUserId) return { ok: false, error };
      } else {
        authUserId = data.user.id;
      }
    } else if (password) {
      await sb.auth.admin.updateUserById(authUserId, {
        password,
        user_metadata: {
          full_name: user.full_name,
          phone: user.phone,
          role: user.role || 'shop_owner',
          local_user_id: user.id,
        },
      });
    }

    if (!authUserId) {
      log('shop_members', 'missing authUserId — skip Supabase membership link');
      return { ok: false, error: new Error('missing authUserId'), skipped: true };
    }

    // Ensure profile phone/role (trigger may have created a blank row).
    try {
      await sb.from('profiles').upsert(
        {
          id: authUserId,
          full_name: user.full_name ?? '',
          email: user.email,
          phone: user.phone ?? null,
          whatsapp_phone: user.whatsapp_phone ?? user.phone ?? null,
          role: user.role === 'super_admin' ? 'super_admin' : 'shop_owner',
          status: 'active',
          locale: user.locale ?? 'es',
        },
        { onConflict: 'id' },
      );
    } catch (error) {
      log('profiles', error);
    }

    try {
      const { error: memberError } = await sb.from('shop_members').upsert(
        {
          shop_id: shop.id,
          user_id: authUserId,
          role: 'owner',
          is_primary: true,
        },
        { onConflict: 'shop_id,user_id' },
      );
      if (memberError) {
        log('shop_members', memberError);
        return { ok: false, error: memberError, authUserId };
      }
    } catch (error) {
      log('shop_members', error);
      return { ok: false, error, authUserId };
    }

    return { ok: true, authUserId };
  } catch (error) {
    log('syncOwner', error);
    return { ok: false, error };
  }
}

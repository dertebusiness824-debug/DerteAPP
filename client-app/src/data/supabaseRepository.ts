/**
 * Repositorio real: habla directamente con el Supabase de derteapp.
 *
 * Lecturas → tablas `marketplace_*` (RLS: catálogo público, datos personales
 * solo del cliente autenticado).
 * Escrituras → RPC `marketplace_*`, que inyectan en `appointments` y
 * `urgencias` del panel B2B.
 * Tiempo real → canales `postgres_changes` sobre el catálogo y las citas.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseCredentials } from '@/config';
import { MarketplaceError, toMarketplaceError, unwrap } from './errors';
import {
  mapBooking,
  mapReview,
  mapShopListing,
  mapShopService,
  mapUrgentRequest,
  mapWeeklyHour,
} from './mappers';
import type {
  AuthCredentials,
  BookingDraft,
  BookingResult,
  CustomerActivity,
  CustomerProfile,
  ListShopsParams,
  MarketplaceRepository,
  ReviewDraft,
  ShopDetail,
  ShopListing,
  ShopReview,
  ShopService,
  SlotLoadEntry,
  Unsubscribe,
  UrgentRequestDraft,
  UrgentRequestResult,
  Vehicle,
  WeeklyHour,
} from './types';

const LISTING_COLUMNS = [
  'shop_id',
  'name',
  'slug',
  'phone',
  'whatsapp_phone',
  'email',
  'address',
  'city',
  'timezone',
  'website_url',
  'slot_minutes',
  'capacity',
  'min_notice_minutes',
  'booking_horizon_days',
  'services',
  'latitude',
  'longitude',
  'neighborhood',
  'headline',
  'description',
  'cover_image_url',
  'accepts_urgent_24h',
  'urgent_notes',
  'rating_avg',
  'rating_count',
].join(', ');

type Row = Record<string, unknown>;

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = map.get(id);
    if (bucket) bucket.push(row);
    else map.set(id, [row]);
  }
  return map;
}

export class SupabaseRepository implements MarketplaceRepository {
  readonly mode = 'supabase' as const;

  private readonly client: SupabaseClient;

  constructor(credentials: SupabaseCredentials) {
    this.client = createClient(credentials.url, credentials.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'derteapp-marketplace-auth',
      },
      global: { headers: { 'x-client-info': 'derteapp-marketplace/0.1.0' } },
    });
  }

  // --- Sesión ---------------------------------------------------------------

  private async userId(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private async requireUserId(): Promise<string> {
    const id = await this.userId();
    if (!id) {
      throw new MarketplaceError('Inicia sesión para continuar.', 'auth_required');
    }
    return id;
  }

  async signIn({ email, password }: AuthCredentials): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw toMarketplaceError(error, 'No pudimos iniciar sesión.');
    await this.ensureCustomer();
  }

  async signUp({
    email,
    password,
    fullName,
    phone,
    city,
  }: AuthCredentials): Promise<{ needsEmailConfirmation: boolean }> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName ?? '',
          phone: phone ?? '',
          city: city ?? '',
          // El panel B2B solo conoce shop_owner / super_admin: el marketplace
          // marca a sus usuarios como clientes finales.
          role: 'customer',
        },
      },
    });
    if (error) throw toMarketplaceError(error, 'No pudimos crear la cuenta.');

    if (data.session) {
      await this.ensureCustomer({ fullName, phone, city });
      return { needsEmailConfirmation: false };
    }
    return { needsEmailConfirmation: true };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  onAuthStateChange(listener: () => void): Unsubscribe {
    const { data } = this.client.auth.onAuthStateChange(() => listener());
    return () => data.subscription.unsubscribe();
  }

  private async ensureCustomer(
    profile: { fullName?: string; phone?: string; city?: string } = {},
  ): Promise<void> {
    const { data: session } = await this.client.auth.getSession();
    const user = session.session?.user;
    if (!user) return;

    const metadata = (user.user_metadata ?? {}) as Row;
    const { error } = await this.client.rpc('marketplace_ensure_customer', {
      p_full_name: profile.fullName ?? (metadata.full_name as string) ?? '',
      p_phone: profile.phone ?? (metadata.phone as string) ?? null,
      p_email: user.email ?? null,
      p_city: profile.city ?? (metadata.city as string) ?? null,
    });
    if (error) throw toMarketplaceError(error, 'No pudimos preparar tu perfil.');
  }

  // --- Catálogo -------------------------------------------------------------

  async listShops(params: ListShopsParams = {}): Promise<ShopListing[]> {
    let query = this.client.from('marketplace_shop_listings').select(LISTING_COLUMNS);
    if (params.city) query = query.ilike('city', params.city);

    const listings = unwrap(await query.order('rating_avg', { ascending: false })) as unknown as Row[];
    if (listings.length === 0) return [];

    const ids = listings.map((row) => String(row.shop_id));
    const [hours, services] = await Promise.all([
      this.fetchHours(ids),
      this.fetchServices(ids),
    ]);

    return listings.map((row) =>
      mapShopListing(row, hours.get(String(row.shop_id)) ?? [], services.get(String(row.shop_id)) ?? []),
    );
  }

  async getShop(shopId: string): Promise<ShopDetail | null> {
    const listing = unwrap(
      await this.client
        .from('marketplace_shop_listings')
        .select(LISTING_COLUMNS)
        .eq('shop_id', shopId)
        .maybeSingle(),
    ) as Row | null;
    if (!listing) return null;

    const [hours, services, reviews] = await Promise.all([
      this.fetchHours([shopId]),
      this.fetchServices([shopId]),
      this.fetchReviews(shopId),
    ]);

    return {
      ...mapShopListing(listing, hours.get(shopId) ?? [], services.get(shopId) ?? []),
      reviews,
    };
  }

  private async fetchHours(shopIds: string[]): Promise<Map<string, WeeklyHour[]>> {
    const rows = unwrap(
      await this.client
        .from('marketplace_shop_hours')
        .select('shop_id, weekday, is_closed, open_time, close_time, break_start, break_end')
        .in('shop_id', shopIds),
    ) as Row[];

    const grouped = groupBy(rows, (row) => String(row.shop_id));
    const result = new Map<string, WeeklyHour[]>();
    for (const [shopId, entries] of grouped) {
      result.set(
        shopId,
        entries.map(mapWeeklyHour).sort((a, b) => a.weekday - b.weekday),
      );
    }
    return result;
  }

  private async fetchServices(shopIds: string[]): Promise<Map<string, ShopService[]>> {
    const rows = unwrap(
      await this.client
        .from('marketplace_shop_services')
        .select(
          'id, shop_id, slug, name, description, price_from, price_to, currency, duration_minutes, sort_order',
        )
        .in('shop_id', shopIds)
        .order('sort_order', { ascending: true }),
    ) as Row[];

    const grouped = groupBy(rows, (row) => String(row.shop_id));
    const result = new Map<string, ShopService[]>();
    for (const [shopId, entries] of grouped) {
      result.set(shopId, entries.map(mapShopService));
    }
    return result;
  }

  private async fetchReviews(shopId: string): Promise<ShopReview[]> {
    const rows = unwrap(
      await this.client
        .from('marketplace_reviews')
        .select('id, author_name, rating, comment, service_tag, created_at')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(30),
    ) as Row[];
    return rows.map(mapReview);
  }

  async getSlotLoad(shopId: string, fromIso: string, toIso: string): Promise<SlotLoadEntry[]> {
    const rows = unwrap(
      await this.client.rpc('marketplace_slot_load', {
        p_shop_id: shopId,
        p_from: fromIso,
        p_to: toIso,
      }),
    ) as Row[];

    return (rows ?? []).map((row) => ({
      slotStart: String(row.slot_start),
      booked: Number(row.booked ?? 0),
    }));
  }

  // --- Perfil ---------------------------------------------------------------

  async getProfile(): Promise<CustomerProfile | null> {
    const userId = await this.userId();
    if (!userId) return null;

    const row = unwrap(
      await this.client
        .from('marketplace_customers')
        .select('id, full_name, email, phone, city')
        .eq('id', userId)
        .maybeSingle(),
    ) as Row | null;

    if (!row) {
      await this.ensureCustomer();
      return { id: userId, fullName: '', email: null, phone: null, city: null };
    }

    return {
      id: String(row.id),
      fullName: String(row.full_name ?? ''),
      email: (row.email as string) ?? null,
      phone: (row.phone as string) ?? null,
      city: (row.city as string) ?? null,
    };
  }

  async updateProfile(patch: Partial<Omit<CustomerProfile, 'id'>>): Promise<CustomerProfile> {
    const userId = await this.requireUserId();
    const row = unwrap(
      await this.client
        .from('marketplace_customers')
        .update({
          full_name: patch.fullName,
          phone: patch.phone,
          city: patch.city,
        })
        .eq('id', userId)
        .select('id, full_name, email, phone, city')
        .single(),
    ) as Row;

    return {
      id: String(row.id),
      fullName: String(row.full_name ?? ''),
      email: (row.email as string) ?? null,
      phone: (row.phone as string) ?? null,
      city: (row.city as string) ?? null,
    };
  }

  // --- Citas y urgencias ----------------------------------------------------

  async listActivity(): Promise<CustomerActivity[]> {
    const userId = await this.userId();
    if (!userId) return [];

    const [bookings, urgent] = await Promise.all([
      this.client
        .from('marketplace_bookings')
        .select('*')
        .order('scheduled_at', { ascending: false })
        .limit(100),
      this.client
        .from('marketplace_urgent_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const bookingRows = unwrap(bookings) as Row[];
    const urgentRows = unwrap(urgent) as Row[];
    return [...bookingRows.map(mapBooking), ...urgentRows.map(mapUrgentRequest)];
  }

  async createBooking(draft: BookingDraft): Promise<BookingResult> {
    await this.requireUserId();
    await this.ensureCustomer({ fullName: draft.customerName, phone: draft.customerPhone });

    const payload = unwrap(
      await this.client.rpc('marketplace_create_booking', {
        p_shop_id: draft.shopId,
        p_scheduled_at: draft.scheduledAt,
        p_customer_name: draft.customerName,
        p_customer_phone: draft.customerPhone,
        p_service_name: draft.serviceName,
        p_customer_email: draft.customerEmail,
        p_vehicle_make: draft.vehicleMake,
        p_vehicle_model: draft.vehicleModel,
        p_vehicle_plate: draft.vehiclePlate,
        p_vehicle_year: draft.vehicleYear,
        p_notes: draft.notes,
        p_duration_minutes: draft.durationMinutes,
        p_price_estimate: draft.priceEstimate,
      }),
      'No pudimos crear la reserva.',
    ) as Row;

    return {
      bookingId: String(payload.booking_id),
      appointmentId: (payload.appointment_id as string) ?? null,
      reference: (payload.reference as string) ?? null,
      status: (payload.status as BookingResult['status']) ?? 'confirmed',
      scheduledAt: String(payload.scheduled_at),
      shopName: String(payload.shop_name ?? ''),
      shopPhone: (payload.shop_phone as string) ?? null,
      shopAddress: (payload.shop_address as string) ?? null,
      timezone: String(payload.timezone ?? 'Europe/Madrid'),
    };
  }

  async cancelBooking(bookingId: string): Promise<void> {
    await this.requireUserId();
    unwrap(
      await this.client.rpc('marketplace_cancel_booking', { p_booking_id: bookingId }),
      'No pudimos cancelar la cita.',
    );
  }

  async createUrgentRequest(draft: UrgentRequestDraft): Promise<UrgentRequestResult> {
    await this.requireUserId();
    await this.ensureCustomer({ fullName: draft.customerName, phone: draft.customerPhone });

    const payload = unwrap(
      await this.client.rpc('marketplace_create_urgent_request', {
        p_shop_id: draft.shopId,
        p_customer_name: draft.customerName,
        p_customer_phone: draft.customerPhone,
        p_reason: draft.reason,
        p_location_text: draft.locationText,
        p_vehicle_make: draft.vehicleMake,
        p_vehicle_model: draft.vehicleModel,
        p_vehicle_plate: draft.vehiclePlate,
      }),
      'No pudimos enviar la solicitud urgente.',
    ) as Row;

    return {
      requestId: String(payload.request_id),
      urgenciaId: (payload.urgencia_id as string) ?? null,
      status: 'pending',
      shopName: String(payload.shop_name ?? ''),
      shopPhone: (payload.shop_phone as string) ?? null,
      reachedB2bPanel: Boolean(payload.reached_b2b_panel),
    };
  }

  // --- Favoritos ------------------------------------------------------------

  async listFavorites(): Promise<string[]> {
    const userId = await this.userId();
    if (!userId) return [];
    const rows = unwrap(
      await this.client.from('marketplace_favorites').select('shop_id'),
    ) as Row[];
    return rows.map((row) => String(row.shop_id));
  }

  async setFavorite(shopId: string, favorite: boolean): Promise<void> {
    const userId = await this.requireUserId();
    if (favorite) {
      unwrap(
        await this.client
          .from('marketplace_favorites')
          .upsert({ owner_id: userId, shop_id: shopId })
          .select('shop_id'),
      );
      return;
    }
    unwrap(
      await this.client
        .from('marketplace_favorites')
        .delete()
        .eq('owner_id', userId)
        .eq('shop_id', shopId)
        .select('shop_id'),
    );
  }

  // --- Vehículos ------------------------------------------------------------

  async listVehicles(): Promise<Vehicle[]> {
    const userId = await this.userId();
    if (!userId) return [];

    const rows = unwrap(
      await this.client
        .from('marketplace_vehicles')
        .select('id, make, model, year, plate, fuel, is_default')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true }),
    ) as Row[];

    return rows.map((row) => ({
      id: String(row.id),
      make: String(row.make ?? ''),
      model: String(row.model ?? ''),
      year: row.year === null || row.year === undefined ? null : Number(row.year),
      plate: String(row.plate ?? ''),
      fuel: (row.fuel as string) ?? null,
      isDefault: Boolean(row.is_default),
    }));
  }

  async saveVehicle(vehicle: Omit<Vehicle, 'id'> & { id?: string }): Promise<Vehicle> {
    const userId = await this.requireUserId();
    const payload = {
      owner_id: userId,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      plate: vehicle.plate,
      fuel: vehicle.fuel,
      is_default: vehicle.isDefault,
    };

    const row = unwrap(
      vehicle.id
        ? await this.client
            .from('marketplace_vehicles')
            .update(payload)
            .eq('id', vehicle.id)
            .select('id, make, model, year, plate, fuel, is_default')
            .single()
        : await this.client
            .from('marketplace_vehicles')
            .insert(payload)
            .select('id, make, model, year, plate, fuel, is_default')
            .single(),
      'No pudimos guardar el vehículo.',
    ) as Row;

    if (vehicle.isDefault) {
      await this.client
        .from('marketplace_vehicles')
        .update({ is_default: false })
        .eq('owner_id', userId)
        .neq('id', String(row.id));
    }

    return {
      id: String(row.id),
      make: String(row.make ?? ''),
      model: String(row.model ?? ''),
      year: row.year === null || row.year === undefined ? null : Number(row.year),
      plate: String(row.plate ?? ''),
      fuel: (row.fuel as string) ?? null,
      isDefault: Boolean(row.is_default),
    };
  }

  async removeVehicle(vehicleId: string): Promise<void> {
    const userId = await this.requireUserId();
    unwrap(
      await this.client
        .from('marketplace_vehicles')
        .delete()
        .eq('id', vehicleId)
        .eq('owner_id', userId)
        .select('id'),
      'No pudimos borrar el vehículo.',
    );
  }

  // --- Opiniones ------------------------------------------------------------

  async submitReview(draft: ReviewDraft): Promise<ShopReview> {
    const userId = await this.requireUserId();
    const profile = await this.getProfile();

    const row = unwrap(
      await this.client
        .from('marketplace_reviews')
        .insert({
          shop_id: draft.shopId,
          customer_id: userId,
          author_name: profile?.fullName || 'Cliente verificado',
          rating: draft.rating,
          comment: draft.comment,
          service_tag: draft.serviceTag,
        })
        .select('id, author_name, rating, comment, service_tag, created_at')
        .single(),
      'No pudimos publicar tu opinión.',
    ) as Row;

    return mapReview(row);
  }

  // --- Tiempo real ----------------------------------------------------------

  subscribeToCatalog(onChange: () => void): Unsubscribe {
    const channel = this.client
      .channel('marketplace-catalog')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_shop_listings' },
        () => onChange(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_shop_services' },
        () => onChange(),
      )
      .subscribe();

    return () => {
      void this.client.removeChannel(channel);
    };
  }

  subscribeToActivity(onChange: () => void): Unsubscribe {
    let disposed = false;
    let cleanup: Unsubscribe = () => {};

    void this.userId().then((userId) => {
      if (disposed || !userId) return;
      const channel = this.client
        .channel(`marketplace-activity-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'marketplace_bookings',
            filter: `customer_id=eq.${userId}`,
          },
          () => onChange(),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'marketplace_urgent_requests',
            filter: `customer_id=eq.${userId}`,
          },
          () => onChange(),
        )
        .subscribe();

      cleanup = () => {
        void this.client.removeChannel(channel);
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }
}

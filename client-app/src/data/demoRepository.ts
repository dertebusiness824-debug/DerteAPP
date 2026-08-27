/**
 * Repositorio de demostración: mismo contrato que `SupabaseRepository` pero
 * contra un catálogo local.
 *
 * Sirve para desarrollar y revisar la interfaz sin credenciales de Supabase.
 * Las reservas se guardan en `localStorage` y los cambios se propagan por
 * `BroadcastChannel`, así que la suscripción «en tiempo real» de las pantallas
 * es exactamente la misma que en producción (se puede comprobar abriendo dos
 * pestañas).
 */
import { MarketplaceError } from './errors';
import { buildDemoReviews, buildDemoShops } from './demoData';
import type {
  AuthCredentials,
  BookingDraft,
  BookingResult,
  CustomerActivity,
  CustomerBooking,
  CustomerProfile,
  CustomerUrgentRequest,
  ListShopsParams,
  MarketplaceRepository,
  ReviewDraft,
  ShopDetail,
  ShopListing,
  ShopReview,
  SlotLoadEntry,
  Unsubscribe,
  UrgentRequestDraft,
  UrgentRequestResult,
  Vehicle,
} from './types';

const STORAGE_KEY = 'derteapp-marketplace-demo-v1';
const CHANNEL_NAME = 'derteapp-marketplace-demo';

interface DemoState {
  profile: CustomerProfile | null;
  vehicles: Vehicle[];
  favorites: string[];
  bookings: CustomerBooking[];
  urgent: CustomerUrgentRequest[];
  reviews: Record<string, ShopReview[]>;
}

type DemoEvent = 'catalog' | 'activity';

function randomId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2).padEnd(12, '0');
  return `${prefix}-${random.slice(0, 12)}`;
}

function reference(): string {
  return `APT-${randomId('').replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase()}`;
}

export class DemoRepository implements MarketplaceRepository {
  readonly mode = 'demo' as const;

  private readonly shops: ShopListing[] = buildDemoShops();

  private state: DemoState;

  private readonly channel: BroadcastChannel | null;

  private readonly listeners = new Map<DemoEvent, Set<() => void>>();

  private readonly authListeners = new Set<() => void>();

  constructor() {
    this.state = this.load();
    this.channel =
      typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;

    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<{ type: DemoEvent }>) => {
        // Otra pestaña ha cambiado algo: recargar y avisar a las pantallas.
        this.state = this.load();
        this.emitLocal(event.data?.type ?? 'activity');
      };
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) return;
        this.state = this.load();
        this.emitLocal('activity');
        this.authListeners.forEach((listener) => listener());
      });
    }
  }

  // --- Persistencia ---------------------------------------------------------

  private emptyState(): DemoState {
    return {
      profile: null,
      vehicles: [],
      favorites: [],
      bookings: [],
      urgent: [],
      reviews: buildDemoReviews(),
    };
  }

  private load(): DemoState {
    const fallback = this.emptyState();
    if (typeof localStorage === 'undefined') return fallback;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      return {
        profile: parsed.profile ?? null,
        vehicles: parsed.vehicles ?? [],
        favorites: parsed.favorites ?? [],
        bookings: parsed.bookings ?? [],
        urgent: parsed.urgent ?? [],
        reviews: { ...fallback.reviews, ...(parsed.reviews ?? {}) },
      };
    } catch {
      return fallback;
    }
  }

  private persist(event: DemoEvent = 'activity'): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        // Modo privado o cuota agotada: la sesión sigue en memoria.
      }
    }
    this.emitLocal(event);
    this.channel?.postMessage({ type: event });
  }

  private emitLocal(event: DemoEvent): void {
    this.listeners.get(event)?.forEach((listener) => listener());
  }

  private subscribe(event: DemoEvent, listener: () => void): Unsubscribe {
    const bucket = this.listeners.get(event) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(event, bucket);
    return () => bucket.delete(listener);
  }

  private requireProfile(): CustomerProfile {
    if (!this.state.profile) {
      throw new MarketplaceError('Inicia sesión para continuar.', 'auth_required');
    }
    return this.state.profile;
  }

  // --- Catálogo -------------------------------------------------------------

  async listShops(params: ListShopsParams = {}): Promise<ShopListing[]> {
    const city = params.city?.trim().toLowerCase();
    if (!city) return this.shops;
    return this.shops.filter((shop) => shop.city?.toLowerCase() === city);
  }

  async getShop(shopId: string): Promise<ShopDetail | null> {
    const shop = this.shops.find((entry) => entry.id === shopId);
    if (!shop) return null;
    return { ...shop, reviews: this.state.reviews[shopId] ?? [] };
  }

  async getSlotLoad(shopId: string, fromIso: string, toIso: string): Promise<SlotLoadEntry[]> {
    const from = new Date(fromIso).getTime();
    const to = new Date(toIso).getTime();
    const counts = new Map<string, number>();

    for (const booking of this.state.bookings) {
      if (booking.shopId !== shopId) continue;
      if (booking.status === 'cancelled' || booking.status === 'no_show') continue;
      const slot = new Date(booking.scheduledAt).getTime();
      if (slot < from || slot >= to) continue;
      const key = new Date(booking.scheduledAt).toISOString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()].map(([slotStart, booked]) => ({ slotStart, booked }));
  }

  // --- Perfil ---------------------------------------------------------------

  async getProfile(): Promise<CustomerProfile | null> {
    return this.state.profile;
  }

  async updateProfile(patch: Partial<Omit<CustomerProfile, 'id'>>): Promise<CustomerProfile> {
    const profile = this.requireProfile();
    this.state.profile = { ...profile, ...patch };
    this.persist();
    return this.state.profile;
  }

  async signIn({ email, password, fullName, phone, city }: AuthCredentials): Promise<void> {
    if (!email.trim() || password.length < 6) {
      throw new MarketplaceError(
        'Escribe un email válido y una contraseña de al menos 6 caracteres.',
        'invalid_credentials',
      );
    }

    this.state.profile = {
      id: this.state.profile?.id ?? randomId('demo-customer'),
      fullName: fullName?.trim() || this.state.profile?.fullName || email.split('@')[0],
      email,
      phone: phone?.trim() || this.state.profile?.phone || null,
      city: city?.trim() || this.state.profile?.city || null,
    };
    this.persist();
    this.authListeners.forEach((listener) => listener());
  }

  async signUp(credentials: AuthCredentials): Promise<{ needsEmailConfirmation: boolean }> {
    await this.signIn(credentials);
    return { needsEmailConfirmation: false };
  }

  async signOut(): Promise<void> {
    this.state.profile = null;
    this.persist();
    this.authListeners.forEach((listener) => listener());
  }

  onAuthStateChange(listener: () => void): Unsubscribe {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  // --- Citas y urgencias ----------------------------------------------------

  async listActivity(): Promise<CustomerActivity[]> {
    if (!this.state.profile) return [];
    return [...this.state.bookings, ...this.state.urgent];
  }

  async createBooking(draft: BookingDraft): Promise<BookingResult> {
    const profile = this.requireProfile();
    const shop = this.shops.find((entry) => entry.id === draft.shopId);
    if (!shop) throw new MarketplaceError('Este taller no está disponible.', 'shop_unavailable');

    // Mismas reglas que el RPC `marketplace_create_booking`.
    const slot = new Date(draft.scheduledAt).getTime();
    if (slot < Date.now() + shop.minNoticeMinutes * 60_000) {
      throw new MarketplaceError(
        `Este taller necesita al menos ${shop.minNoticeMinutes} minutos de antelación.`,
        'too_soon',
      );
    }
    if (slot > Date.now() + shop.bookingHorizonDays * 86_400_000) {
      throw new MarketplaceError('Esa fecha está fuera del calendario del taller.', 'too_far');
    }

    const booked = this.state.bookings.filter(
      (entry) =>
        entry.shopId === shop.id &&
        entry.scheduledAt === draft.scheduledAt &&
        entry.status !== 'cancelled' &&
        entry.status !== 'no_show',
    ).length;
    if (booked >= shop.capacity) {
      throw new MarketplaceError('Ese hueco acaba de ocuparse. Elige otra hora.', 'slot_taken');
    }

    const booking: CustomerBooking = {
      kind: 'booking',
      id: randomId('demo-booking'),
      appointmentId: randomId('demo-appointment'),
      shopId: shop.id,
      shopName: shop.name,
      shopPhone: shop.phone,
      shopAddress: shop.address,
      reference: reference(),
      status: 'confirmed',
      scheduledAt: draft.scheduledAt,
      durationMinutes: draft.durationMinutes ?? shop.slotMinutes,
      serviceName: draft.serviceName,
      priceEstimate: draft.priceEstimate,
      vehicleMake: draft.vehicleMake,
      vehicleModel: draft.vehicleModel,
      vehiclePlate: draft.vehiclePlate,
      notes: draft.notes,
      timezone: shop.timezone,
      createdAt: new Date().toISOString(),
    };

    this.state.bookings = [booking, ...this.state.bookings];
    this.state.profile = {
      ...profile,
      fullName: draft.customerName || profile.fullName,
      phone: draft.customerPhone || profile.phone,
    };
    this.persist();

    return {
      bookingId: booking.id,
      appointmentId: booking.appointmentId,
      reference: booking.reference,
      status: booking.status,
      scheduledAt: booking.scheduledAt,
      shopName: shop.name,
      shopPhone: shop.phone,
      shopAddress: shop.address,
      timezone: shop.timezone,
    };
  }

  async cancelBooking(bookingId: string): Promise<void> {
    this.requireProfile();
    const booking = this.state.bookings.find((entry) => entry.id === bookingId);
    if (!booking) throw new MarketplaceError('No encontramos esa cita.', 'booking_not_found');
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new MarketplaceError('Esa cita ya está cerrada.', 'booking_not_cancellable');
    }

    this.state.bookings = this.state.bookings.map((entry) =>
      entry.id === bookingId ? { ...entry, status: 'cancelled' } : entry,
    );
    this.persist();
  }

  async createUrgentRequest(draft: UrgentRequestDraft): Promise<UrgentRequestResult> {
    this.requireProfile();
    const shop = this.shops.find((entry) => entry.id === draft.shopId);
    if (!shop) throw new MarketplaceError('Este taller no está disponible.', 'shop_unavailable');
    if (draft.customerPhone.trim().length < 6) {
      throw new MarketplaceError(
        'Necesitamos un teléfono para que el taller te llame.',
        'invalid_phone',
      );
    }

    const request: CustomerUrgentRequest = {
      kind: 'urgent',
      id: randomId('demo-urgent'),
      urgenciaId: randomId('demo-urgencia'),
      shopId: shop.id,
      shopName: shop.name,
      shopPhone: shop.phone,
      status: 'pending',
      title: 'Solicitud de servicio urgente',
      reason: draft.reason,
      locationText: draft.locationText,
      vehicleMake: draft.vehicleMake,
      vehicleModel: draft.vehicleModel,
      vehiclePlate: draft.vehiclePlate,
      reachedB2bPanel: true,
      acceptedAt: null,
      createdAt: new Date().toISOString(),
    };

    this.state.urgent = [request, ...this.state.urgent];
    this.persist();

    return {
      requestId: request.id,
      urgenciaId: request.urgenciaId,
      status: 'pending',
      shopName: shop.name,
      shopPhone: shop.phone,
      reachedB2bPanel: true,
    };
  }

  // --- Favoritos y vehículos ------------------------------------------------

  async listFavorites(): Promise<string[]> {
    return this.state.favorites;
  }

  async setFavorite(shopId: string, favorite: boolean): Promise<void> {
    this.requireProfile();
    const current = new Set(this.state.favorites);
    if (favorite) current.add(shopId);
    else current.delete(shopId);
    this.state.favorites = [...current];
    this.persist();
  }

  async listVehicles(): Promise<Vehicle[]> {
    return this.state.vehicles;
  }

  async saveVehicle(vehicle: Omit<Vehicle, 'id'> & { id?: string }): Promise<Vehicle> {
    this.requireProfile();
    const saved: Vehicle = { ...vehicle, id: vehicle.id ?? randomId('demo-vehicle') };

    const existing = this.state.vehicles.some((entry) => entry.id === saved.id);
    this.state.vehicles = existing
      ? this.state.vehicles.map((entry) => (entry.id === saved.id ? saved : entry))
      : [...this.state.vehicles, saved];

    if (saved.isDefault) {
      this.state.vehicles = this.state.vehicles.map((entry) =>
        entry.id === saved.id ? entry : { ...entry, isDefault: false },
      );
    }

    this.persist();
    return saved;
  }

  async removeVehicle(vehicleId: string): Promise<void> {
    this.requireProfile();
    this.state.vehicles = this.state.vehicles.filter((entry) => entry.id !== vehicleId);
    this.persist();
  }

  async submitReview(draft: ReviewDraft): Promise<ShopReview> {
    const profile = this.requireProfile();
    const review: ShopReview = {
      id: randomId('demo-review'),
      authorName: profile.fullName || 'Cliente verificado',
      rating: draft.rating,
      comment: draft.comment,
      serviceTag: draft.serviceTag,
      createdAt: new Date().toISOString(),
    };

    this.state.reviews = {
      ...this.state.reviews,
      [draft.shopId]: [review, ...(this.state.reviews[draft.shopId] ?? [])],
    };
    this.persist('catalog');
    return review;
  }

  subscribeToCatalog(onChange: () => void): Unsubscribe {
    return this.subscribe('catalog', onChange);
  }

  subscribeToActivity(onChange: () => void): Unsubscribe {
    return this.subscribe('activity', onChange);
  }
}

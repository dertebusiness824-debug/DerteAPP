/** Modelo de datos de la PWA de clientes (mapeado desde las tablas `marketplace_*`). */

export interface WeeklyHour {
  /** 0 = domingo … 6 = sábado (igual que `business_hours.weekday`). */
  weekday: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface ShopService {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string;
  durationMinutes: number | null;
}

export interface ShopReview {
  id: string;
  authorName: string;
  rating: number;
  comment: string | null;
  serviceTag: string | null;
  createdAt: string;
}

export interface ShopListing {
  id: string;
  name: string;
  slug: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  timezone: string;
  websiteUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  headline: string | null;
  description: string | null;
  coverImageUrl: string | null;
  acceptsUrgent24h: boolean;
  urgentNotes: string | null;
  ratingAvg: number;
  ratingCount: number;
  slotMinutes: number;
  capacity: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  services: ShopService[];
  hours: WeeklyHour[];
}

export interface ShopDetail extends ShopListing {
  reviews: ShopReview[];
}

export interface SlotLoadEntry {
  /** Instante exacto del hueco, en ISO 8601. */
  slotStart: string;
  booked: number;
}

/** Estados que usa el panel B2B (`appointments.status`). */
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type UrgentStatus = 'pending' | 'accepted' | 'cancelled';

export interface CustomerBooking {
  kind: 'booking';
  id: string;
  appointmentId: string | null;
  shopId: string;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  reference: string | null;
  status: BookingStatus;
  scheduledAt: string;
  durationMinutes: number;
  serviceName: string | null;
  priceEstimate: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehiclePlate: string | null;
  notes: string | null;
  timezone: string;
  createdAt: string;
}

export interface CustomerUrgentRequest {
  kind: 'urgent';
  id: string;
  urgenciaId: string | null;
  shopId: string;
  shopName: string;
  shopPhone: string | null;
  status: UrgentStatus;
  title: string;
  reason: string | null;
  locationText: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehiclePlate: string | null;
  reachedB2bPanel: boolean;
  acceptedAt: string | null;
  createdAt: string;
}

export type CustomerActivity = CustomerBooking | CustomerUrgentRequest;

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  plate: string;
  fuel: string | null;
  isDefault: boolean;
}

export interface CustomerProfile {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
}

export interface BookingDraft {
  shopId: string;
  scheduledAt: string;
  serviceName: string | null;
  priceEstimate: number | null;
  durationMinutes: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleYear: number | null;
  notes: string | null;
}

export interface BookingResult {
  bookingId: string;
  appointmentId: string | null;
  reference: string | null;
  status: BookingStatus;
  scheduledAt: string;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  timezone: string;
}

export interface UrgentRequestDraft {
  shopId: string;
  customerName: string;
  customerPhone: string;
  reason: string | null;
  locationText: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehiclePlate: string | null;
}

export interface UrgentRequestResult {
  requestId: string;
  urgenciaId: string | null;
  status: UrgentStatus;
  shopName: string;
  shopPhone: string | null;
  /** `false` cuando el proyecto de Supabase no tiene la tabla `urgencias`. */
  reachedB2bPanel: boolean;
}

export interface ReviewDraft {
  shopId: string;
  rating: number;
  comment: string | null;
  serviceTag: string | null;
}

export interface ListShopsParams {
  city?: string | null;
}

export type Unsubscribe = () => void;

export interface AuthCredentials {
  email: string;
  password: string;
  fullName?: string;
  phone?: string;
  city?: string;
}

/**
 * Contrato único de datos. `supabaseRepository` habla con Supabase (REST +
 * RPC + Realtime) y `demoRepository` con un catálogo local; las pantallas no
 * saben cuál está activo.
 */
export interface MarketplaceRepository {
  readonly mode: 'supabase' | 'demo';

  listShops(params?: ListShopsParams): Promise<ShopListing[]>;
  getShop(shopId: string): Promise<ShopDetail | null>;
  getSlotLoad(shopId: string, fromIso: string, toIso: string): Promise<SlotLoadEntry[]>;

  getProfile(): Promise<CustomerProfile | null>;
  updateProfile(patch: Partial<Omit<CustomerProfile, 'id'>>): Promise<CustomerProfile>;

  listActivity(): Promise<CustomerActivity[]>;
  createBooking(draft: BookingDraft): Promise<BookingResult>;
  cancelBooking(bookingId: string): Promise<void>;
  createUrgentRequest(draft: UrgentRequestDraft): Promise<UrgentRequestResult>;

  listFavorites(): Promise<string[]>;
  setFavorite(shopId: string, favorite: boolean): Promise<void>;

  listVehicles(): Promise<Vehicle[]>;
  saveVehicle(vehicle: Omit<Vehicle, 'id'> & { id?: string }): Promise<Vehicle>;
  removeVehicle(vehicleId: string): Promise<void>;

  submitReview(draft: ReviewDraft): Promise<ShopReview>;

  /** Cambios en el catálogo publicado por los talleres (alta, edición, baja). */
  subscribeToCatalog(onChange: () => void): Unsubscribe;
  /** Cambios de estado en las citas y urgencias del cliente autenticado. */
  subscribeToActivity(onChange: () => void): Unsubscribe;

  signIn(credentials: AuthCredentials): Promise<void>;
  signUp(credentials: AuthCredentials): Promise<{ needsEmailConfirmation: boolean }>;
  signOut(): Promise<void>;
  onAuthStateChange(listener: () => void): Unsubscribe;
}

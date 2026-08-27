/** Conversión de filas de Supabase al modelo de la app. */
import { foldText } from '@/lib/format';
import { SERVICE_CATEGORIES } from '@/lib/search';
import type {
  BookingStatus,
  CustomerBooking,
  CustomerUrgentRequest,
  ShopListing,
  ShopReview,
  ShopService,
  UrgentStatus,
  WeeklyHour,
} from './types';

type Row = Record<string, unknown>;

const str = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const int = (value: unknown, fallback: number): number => num(value) ?? fallback;

/** Deduce el slug de servicio a partir del nombre que escribió el taller. */
export function deriveServiceSlug(name: string): string {
  const folded = foldText(name);
  const category = SERVICE_CATEGORIES.find((entry) =>
    [entry.label, ...entry.keywords].some((word) => folded.includes(foldText(word))),
  );
  if (category) return category.slug;
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'servicio';
}

export function mapWeeklyHour(row: Row): WeeklyHour {
  return {
    weekday: int(row.weekday, 0),
    isClosed: Boolean(row.is_closed),
    openTime: str(row.open_time),
    closeTime: str(row.close_time),
    breakStart: str(row.break_start),
    breakEnd: str(row.break_end),
  };
}

export function mapShopService(row: Row): ShopService {
  const name = str(row.name) ?? 'Servicio';
  return {
    id: String(row.id ?? `${row.shop_id}-${name}`),
    slug: str(row.slug) ?? deriveServiceSlug(name),
    name,
    description: str(row.description),
    priceFrom: num(row.price_from),
    priceTo: num(row.price_to),
    currency: str(row.currency) ?? 'EUR',
    durationMinutes: num(row.duration_minutes),
  };
}

/**
 * `shops.services` es un JSON libre que rellena el taller en su panel. Se usa
 * como respaldo cuando todavía no hay tarifas en `marketplace_shop_services`.
 */
export function servicesFromShopJson(shopId: string, value: unknown): ShopService[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index): ShopService | null => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (!name) return null;
        return {
          id: `${shopId}-json-${index}`,
          slug: deriveServiceSlug(name),
          name,
          description: null,
          priceFrom: null,
          priceTo: null,
          currency: 'EUR',
          durationMinutes: null,
        };
      }

      if (entry && typeof entry === 'object') {
        const row = entry as Row;
        const name = str(row.name) ?? str(row.label) ?? str(row.title);
        if (!name) return null;
        return {
          id: `${shopId}-json-${index}`,
          slug: str(row.slug) ?? deriveServiceSlug(name),
          name,
          description: str(row.description),
          priceFrom: num(row.price ?? row.price_from),
          priceTo: num(row.price_to),
          currency: str(row.currency) ?? 'EUR',
          durationMinutes: num(row.duration_minutes ?? row.duration),
        };
      }

      return null;
    })
    .filter((service): service is ShopService => service !== null);
}

export function mapShopListing(
  row: Row,
  hours: WeeklyHour[],
  services: ShopService[],
): ShopListing {
  const id = String(row.shop_id ?? row.id);
  const catalogue = services.length > 0 ? services : servicesFromShopJson(id, row.services);

  return {
    id,
    name: str(row.name) ?? 'Taller',
    slug: str(row.slug),
    phone: str(row.phone),
    whatsappPhone: str(row.whatsapp_phone),
    email: str(row.email),
    address: str(row.address),
    city: str(row.city),
    neighborhood: str(row.neighborhood),
    timezone: str(row.timezone) ?? 'Europe/Madrid',
    websiteUrl: str(row.website_url),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    headline: str(row.headline),
    description: str(row.description),
    coverImageUrl: str(row.cover_image_url),
    acceptsUrgent24h: Boolean(row.accepts_urgent_24h),
    urgentNotes: str(row.urgent_notes),
    ratingAvg: num(row.rating_avg) ?? 0,
    ratingCount: int(row.rating_count, 0),
    slotMinutes: int(row.slot_minutes, 60),
    capacity: int(row.capacity, 1),
    minNoticeMinutes: int(row.min_notice_minutes, 60),
    bookingHorizonDays: int(row.booking_horizon_days, 60),
    services: catalogue,
    hours,
  };
}

export function mapReview(row: Row): ShopReview {
  return {
    id: String(row.id),
    authorName: str(row.author_name) ?? 'Cliente verificado',
    rating: int(row.rating, 5),
    comment: str(row.comment),
    serviceTag: str(row.service_tag),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

const BOOKING_STATUSES: BookingStatus[] = [
  'pending',
  'confirmed',
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
];

export function asBookingStatus(value: unknown): BookingStatus {
  const status = String(value ?? '');
  return (BOOKING_STATUSES as string[]).includes(status)
    ? (status as BookingStatus)
    : 'pending';
}

export function asUrgentStatus(value: unknown): UrgentStatus {
  const status = String(value ?? '');
  return status === 'accepted' || status === 'cancelled' ? status : 'pending';
}

export function mapBooking(row: Row): CustomerBooking {
  return {
    kind: 'booking',
    id: String(row.id),
    appointmentId: str(row.appointment_id),
    shopId: String(row.shop_id),
    shopName: str(row.shop_name) ?? 'Taller',
    shopPhone: str(row.shop_phone),
    shopAddress: str(row.shop_address),
    reference: str(row.reference),
    status: asBookingStatus(row.status),
    scheduledAt: String(row.scheduled_at),
    durationMinutes: int(row.duration_minutes, 60),
    serviceName: str(row.service_name),
    priceEstimate: num(row.price_estimate),
    vehicleMake: str(row.vehicle_make),
    vehicleModel: str(row.vehicle_model),
    vehiclePlate: str(row.vehicle_plate),
    notes: str(row.notes),
    timezone: str(row.timezone) ?? 'Europe/Madrid',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapUrgentRequest(row: Row): CustomerUrgentRequest {
  return {
    kind: 'urgent',
    id: String(row.id),
    urgenciaId: str(row.urgencia_id),
    shopId: String(row.shop_id),
    shopName: str(row.shop_name) ?? 'Taller',
    shopPhone: str(row.shop_phone),
    status: asUrgentStatus(row.status),
    title: str(row.title) ?? 'Solicitud de servicio urgente',
    reason: str(row.reason),
    locationText: str(row.location_text),
    vehicleMake: str(row.vehicle_make),
    vehicleModel: str(row.vehicle_model),
    vehiclePlate: str(row.vehicle_plate),
    reachedB2bPanel: Boolean(row.urgencia_id),
    acceptedAt: str(row.accepted_at),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

import { describe, expect, it } from 'vitest';
import type { ShopListing, WeeklyHour } from '@/data/types';
import {
  buildSuggestions,
  DEFAULT_FILTERS,
  decorateShops,
  filterShops,
  findServiceCategory,
  sortShops,
} from './search';

const OPEN_ALL_WEEK: WeeklyHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isClosed: false,
  openTime: '08:00',
  closeTime: '20:00',
  breakStart: null,
  breakEnd: null,
}));

const CLOSED_ALL_WEEK: WeeklyHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isClosed: true,
  openTime: null,
  closeTime: null,
  breakStart: null,
  breakEnd: null,
}));

function shop(overrides: Partial<ShopListing> & Pick<ShopListing, 'id' | 'name'>): ShopListing {
  return {
    slug: null,
    phone: null,
    whatsappPhone: null,
    email: null,
    address: 'Calle Mayor 1',
    city: 'Madrid',
    neighborhood: 'Centro',
    timezone: 'Europe/Madrid',
    websiteUrl: null,
    latitude: 40.4168,
    longitude: -3.7038,
    headline: null,
    description: null,
    coverImageUrl: null,
    acceptsUrgent24h: false,
    urgentNotes: null,
    ratingAvg: 4,
    ratingCount: 10,
    slotMinutes: 60,
    capacity: 1,
    minNoticeMinutes: 60,
    bookingHorizonDays: 30,
    services: [],
    hours: OPEN_ALL_WEEK,
    promotions: [],
    ...overrides,
  };
}

function service(slug: string, name: string) {
  return {
    id: `svc-${slug}`,
    slug,
    name,
    description: null,
    priceFrom: 49,
    priceTo: null,
    currency: 'EUR',
    durationMinutes: 60,
  };
}

const NOW = new Date('2026-08-27T10:00:00.000Z');
const MADRID = { latitude: 40.4168, longitude: -3.7038 };

const SHOPS: ShopListing[] = [
  shop({
    id: 'near-urgent',
    name: 'Talleres Chamberí Express',
    neighborhood: 'Chamberí',
    latitude: 40.4378,
    longitude: -3.7036,
    acceptsUrgent24h: true,
    ratingAvg: 4.2,
    ratingCount: 40,
    services: [service('frenos', 'Cambio de pastillas de freno')],
  }),
  shop({
    id: 'far-top-rated',
    name: 'Neumáticos Sur',
    neighborhood: 'Carabanchel',
    latitude: 40.3785,
    longitude: -3.7449,
    ratingAvg: 4.9,
    ratingCount: 120,
    services: [service('neumaticos', 'Cambio de neumáticos')],
  }),
  shop({
    id: 'closed-oil',
    name: 'Lubricantes Tetuán',
    neighborhood: 'Tetuán',
    hours: CLOSED_ALL_WEEK,
    ratingAvg: 3.8,
    ratingCount: 8,
    services: [service('cambio-aceite', 'Cambio de aceite y filtros')],
  }),
  shop({
    id: 'other-city',
    name: 'Motor Gràcia',
    city: 'Barcelona',
    neighborhood: 'Gràcia',
    latitude: 41.4036,
    longitude: 2.1564,
    services: [service('frenos', 'Frenos y discos')],
  }),
];

const DECORATED = decorateShops(SHOPS, MADRID, NOW);

describe('decorateShops', () => {
  it('calcula la distancia al origen y el estado de apertura', () => {
    const entry = DECORATED.find((item) => item.shop.id === 'near-urgent');
    expect(entry?.openNow).toBe(true);
    expect(entry?.distanceKm).toBeGreaterThan(2);
    expect(entry?.distanceKm).toBeLessThan(3);
  });

  it('deja la distancia en null cuando el taller no tiene coordenadas', () => {
    const [entry] = decorateShops(
      [shop({ id: 'no-coords', name: 'Sin mapa', latitude: null, longitude: null })],
      MADRID,
      NOW,
    );
    expect(entry.distanceKm).toBeNull();
  });

  it('deja la distancia en null cuando no hay origen', () => {
    expect(decorateShops(SHOPS, null, NOW)[0].distanceKm).toBeNull();
  });
});

describe('filterShops', () => {
  it('filtra por ciudad', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, city: 'Madrid' });
    expect(results.map((entry) => entry.shop.id)).not.toContain('other-city');
    expect(results).toHaveLength(3);
  });

  it('filtra por ciudad ignorando tildes y mayúsculas', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, city: 'barcelona' });
    expect(results.map((entry) => entry.shop.id)).toEqual(['other-city']);
  });

  it('deja solo los talleres abiertos', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, onlyOpen: true });
    expect(results.map((entry) => entry.shop.id)).not.toContain('closed-oil');
  });

  it('deja solo los talleres con urgencias 24h', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, onlyUrgent: true });
    expect(results.map((entry) => entry.shop.id)).toEqual(['near-urgent']);
  });

  it('encuentra por servicio con lenguaje natural y sin tildes', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, query: 'neumaticos' });
    expect(results.map((entry) => entry.shop.id)).toEqual(['far-top-rated']);
  });

  it('encuentra «cambio de aceite» aunque el taller lo llame de otra forma', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, query: 'cambio de aceite' });
    expect(results.map((entry) => entry.shop.id)).toEqual(['closed-oil']);
  });

  it('encuentra por nombre del taller', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, query: 'chamberi' });
    expect(results.map((entry) => entry.shop.id)).toEqual(['near-urgent']);
  });

  it('filtra por categoría de servicio', () => {
    const results = filterShops(DECORATED, { ...DEFAULT_FILTERS, serviceSlug: 'frenos' });
    expect(results.map((entry) => entry.shop.id).sort()).toEqual(['near-urgent', 'other-city']);
  });

  it('reconoce la categoría aunque el taller nombre el servicio a su manera', () => {
    const entries = decorateShops(
      [
        shop({
          id: 'custom-naming',
          name: 'Frenotecnia',
          services: [service('revision-frenado', 'Revisión de discos y latiguillos')],
        }),
      ],
      MADRID,
      NOW,
    );
    const results = filterShops(entries, { ...DEFAULT_FILTERS, serviceSlug: 'frenos' });
    expect(results.map((entry) => entry.shop.id)).toEqual(['custom-naming']);
  });

  it('combina filtros: frenos, abierto y en Madrid', () => {
    const results = filterShops(DECORATED, {
      ...DEFAULT_FILTERS,
      city: 'Madrid',
      serviceSlug: 'frenos',
      onlyOpen: true,
    });
    expect(results.map((entry) => entry.shop.id)).toEqual(['near-urgent']);
  });
});

describe('sortShops', () => {
  it('ordena por cercanía', () => {
    const results = sortShops(
      DECORATED.filter((entry) => entry.shop.city === 'Madrid'),
      'distance',
    );
    expect(results[0].shop.id).toBe('closed-oil');
  });

  it('ordena por valoración', () => {
    expect(sortShops(DECORATED, 'rating')[0].shop.id).toBe('far-top-rated');
  });

  it('pone delante los talleres con urgencias 24h', () => {
    expect(sortShops(DECORATED, 'urgent')[0].shop.id).toBe('near-urgent');
  });

  it('manda al final los talleres sin coordenadas', () => {
    const entries = decorateShops(
      [...SHOPS, shop({ id: 'no-coords', name: 'Sin mapa', latitude: null, longitude: null })],
      MADRID,
      NOW,
    );
    const results = sortShops(entries, 'distance');
    expect(results[results.length - 1].shop.id).toBe('no-coords');
  });
});

describe('buildSuggestions', () => {
  it('no sugiere nada con menos de dos caracteres', () => {
    expect(buildSuggestions(DECORATED, 'a')).toEqual([]);
  });

  it('sugiere servicios y talleres', () => {
    const suggestions = buildSuggestions(DECORATED, 'freno');
    expect(suggestions.some((item) => item.type === 'service' && item.value === 'frenos')).toBe(true);
  });

  it('sugiere el taller por su nombre', () => {
    const suggestions = buildSuggestions(DECORATED, 'gracia');
    expect(suggestions).toEqual([{ type: 'shop', label: 'Motor Gràcia', value: 'other-city' }]);
  });
});

describe('findServiceCategory', () => {
  it('resuelve el slug de una categoría conocida', () => {
    expect(findServiceCategory('neumaticos')?.label).toBe('Neumáticos');
  });

  it('devuelve null para slugs desconocidos', () => {
    expect(findServiceCategory('tuning')).toBeNull();
    expect(findServiceCategory(null)).toBeNull();
  });
});

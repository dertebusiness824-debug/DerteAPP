/** Buscador: catálogo de servicios, filtros y ordenación de talleres. */
import type { ShopListing } from '@/data/types';
import { foldText } from './format';
import { distanceKm, isValidCoordinates, type Coordinates } from './geo';
import { getOpenState } from './hours';

export interface ServiceCategory {
  slug: string;
  label: string;
  /** Sinónimos que también deben encontrar esta categoría. */
  keywords: string[];
}

/** Servicios más buscados por los conductores. */
export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    slug: 'cambio-aceite',
    label: 'Cambio de aceite',
    keywords: ['aceite', 'filtros', 'lubricante', 'mantenimiento'],
  },
  {
    slug: 'frenos',
    label: 'Pastillas de frenos',
    keywords: ['freno', 'frenos', 'pastillas', 'discos', 'latiguillos'],
  },
  {
    slug: 'neumaticos',
    label: 'Neumáticos',
    keywords: ['neumatico', 'neumaticos', 'ruedas', 'equilibrado', 'pinchazo'],
  },
  {
    slug: 'itv',
    label: 'Pre-ITV',
    keywords: ['itv', 'inspeccion', 'revision'],
  },
  {
    slug: 'diagnosis',
    label: 'Diagnosis electrónica',
    keywords: ['diagnosis', 'centralita', 'testigo', 'averia', 'motor'],
  },
  {
    slug: 'aire-acondicionado',
    label: 'Aire acondicionado',
    keywords: ['aire', 'clima', 'climatizador', 'gas'],
  },
  {
    slug: 'bateria',
    label: 'Batería',
    keywords: ['bateria', 'arranque', 'alternador'],
  },
  {
    slug: 'chapa',
    label: 'Chapa y pintura',
    keywords: ['chapa', 'pintura', 'carroceria', 'golpe', 'abolladura'],
  },
];

export function findServiceCategory(slug: string | null): ServiceCategory | null {
  if (!slug) return null;
  return SERVICE_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

export type ShopSort = 'distance' | 'rating' | 'urgent';

export interface ShopFilters {
  query: string;
  city: string | null;
  serviceSlug: string | null;
  onlyOpen: boolean;
  onlyUrgent: boolean;
  sort: ShopSort;
}

export const DEFAULT_FILTERS: ShopFilters = {
  query: '',
  city: null,
  serviceSlug: null,
  onlyOpen: false,
  onlyUrgent: false,
  sort: 'distance',
};

export interface DecoratedShop {
  shop: ShopListing;
  distanceKm: number | null;
  openNow: boolean;
  openLabel: string;
}

/** Añade distancia y estado de apertura a cada taller. */
export function decorateShops(
  shops: ShopListing[],
  origin: Coordinates | null,
  now: Date = new Date(),
): DecoratedShop[] {
  return shops.map((shop) => {
    const openState = getOpenState(shop.hours, shop.timezone, now);
    const coords = { latitude: shop.latitude ?? NaN, longitude: shop.longitude ?? NaN };
    return {
      shop,
      distanceKm:
        origin && isValidCoordinates(coords) ? distanceKm(origin, coords) : null,
      openNow: openState.openNow,
      openLabel: openState.label,
    };
  });
}

function matchesQuery(entry: DecoratedShop, query: string): boolean {
  const needle = foldText(query);
  if (!needle) return true;

  const tokens = needle.split(/\s+/).filter(Boolean);
  const haystack = foldText(
    [
      entry.shop.name,
      entry.shop.headline ?? '',
      entry.shop.description ?? '',
      entry.shop.city ?? '',
      entry.shop.neighborhood ?? '',
      entry.shop.address ?? '',
      entry.shop.services.map((service) => `${service.name} ${service.slug}`).join(' '),
      // Un texto libre como «frenos» también debe encontrar la categoría.
      SERVICE_CATEGORIES.filter((category) =>
        entry.shop.services.some((service) => service.slug === category.slug),
      )
        .flatMap((category) => [category.label, ...category.keywords])
        .join(' '),
    ].join(' '),
  );

  return tokens.every((token) => haystack.includes(token));
}

function matchesService(entry: DecoratedShop, slug: string | null): boolean {
  if (!slug) return true;
  const category = findServiceCategory(slug);
  if (entry.shop.services.some((service) => service.slug === slug)) return true;
  if (!category) return false;

  const haystack = foldText(entry.shop.services.map((service) => service.name).join(' '));
  return category.keywords.some((keyword) => haystack.includes(foldText(keyword)));
}

export function filterShops(entries: DecoratedShop[], filters: ShopFilters): DecoratedShop[] {
  const city = filters.city ? foldText(filters.city) : null;

  const filtered = entries.filter((entry) => {
    if (city && foldText(entry.shop.city ?? '') !== city) return false;
    if (filters.onlyOpen && !entry.openNow) return false;
    if (filters.onlyUrgent && !entry.shop.acceptsUrgent24h) return false;
    if (!matchesService(entry, filters.serviceSlug)) return false;
    return matchesQuery(entry, filters.query);
  });

  return sortShops(filtered, filters.sort);
}

export function sortShops(entries: DecoratedShop[], sort: ShopSort): DecoratedShop[] {
  const sorted = [...entries];

  sorted.sort((a, b) => {
    if (sort === 'rating') {
      if (b.shop.ratingAvg !== a.shop.ratingAvg) return b.shop.ratingAvg - a.shop.ratingAvg;
      return b.shop.ratingCount - a.shop.ratingCount;
    }

    if (sort === 'urgent') {
      const urgentDelta = Number(b.shop.acceptsUrgent24h) - Number(a.shop.acceptsUrgent24h);
      if (urgentDelta !== 0) return urgentDelta;
    }

    // Por distancia: los talleres sin coordenadas van al final.
    if (a.distanceKm === null && b.distanceKm === null) {
      return b.shop.ratingAvg - a.shop.ratingAvg;
    }
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  return sorted;
}

/** Sugerencias del buscador: talleres y servicios que encajan con el texto. */
export function buildSuggestions(
  entries: DecoratedShop[],
  query: string,
  limit = 6,
): Array<{ type: 'shop' | 'service'; label: string; value: string }> {
  const needle = foldText(query);
  if (needle.length < 2) return [];

  const services = SERVICE_CATEGORIES.filter((category) =>
    [category.label, ...category.keywords].some((word) => foldText(word).includes(needle)),
  ).map((category) => ({ type: 'service' as const, label: category.label, value: category.slug }));

  const shops = entries
    .filter((entry) => foldText(entry.shop.name).includes(needle))
    .map((entry) => ({ type: 'shop' as const, label: entry.shop.name, value: entry.shop.id }));

  return [...services, ...shops].slice(0, limit);
}

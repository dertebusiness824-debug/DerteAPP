/** Distancias y ubicaciones para el buscador. */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface CityOption {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  neighborhoods: string[];
}

/** Ciudades con talleres en la plataforma (selector de ubicación). */
export const CITIES: CityOption[] = [
  {
    name: 'Madrid',
    region: 'Comunidad de Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
    neighborhoods: ['Chamberí', 'Salamanca', 'Tetuán', 'Arganzuela', 'Vallecas', 'Carabanchel'],
  },
  {
    name: 'Barcelona',
    region: 'Cataluña',
    latitude: 41.3874,
    longitude: 2.1686,
    neighborhoods: ['Eixample', 'Gràcia', 'Sants', 'Sant Martí', 'Nou Barris'],
  },
  {
    name: 'Valencia',
    region: 'Comunidad Valenciana',
    latitude: 39.4699,
    longitude: -0.3763,
    neighborhoods: ['Ruzafa', 'Benimaclet', 'Campanar', 'Patraix'],
  },
  {
    name: 'Sevilla',
    region: 'Andalucía',
    latitude: 37.3891,
    longitude: -5.9845,
    neighborhoods: ['Nervión', 'Triana', 'Macarena', 'Los Remedios'],
  },
  {
    name: 'Bilbao',
    region: 'País Vasco',
    latitude: 43.263,
    longitude: -2.935,
    neighborhoods: ['Deusto', 'Indautxu', 'Santutxu'],
  },
  {
    name: 'Málaga',
    region: 'Andalucía',
    latitude: 36.7213,
    longitude: -4.4214,
    neighborhoods: ['Teatinos', 'El Palo', 'Carretera de Cádiz'],
  },
  {
    name: 'Las Palmas de Gran Canaria',
    region: 'Canarias',
    latitude: 28.1235,
    longitude: -15.4363,
    neighborhoods: ['Vegueta', 'Schamann', 'La Isleta'],
  },
];

export function findCity(name: string | null | undefined): CityOption | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  return CITIES.find((city) => city.name.toLowerCase() === needle) ?? null;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distancia en kilómetros entre dos puntos (fórmula del semiverseno). */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** «450 m», «2,4 km», «14 km». */
export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/** Tiempo estimado en coche por ciudad (~22 km/h de media). */
export function estimateDriveMinutes(km: number): number {
  return Math.max(3, Math.round((km / 22) * 60));
}

export function isValidCoordinates(
  value: Partial<Coordinates> | null | undefined,
): value is Coordinates {
  return (
    !!value &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  );
}

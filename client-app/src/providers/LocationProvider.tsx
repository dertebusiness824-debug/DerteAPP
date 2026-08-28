import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { appConfig } from '@/config';
import { CITIES, findCity, type Coordinates } from '@/lib/geo';

const STORAGE_KEY = 'derteapp-marketplace-location';

type GeoStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unsupported';

interface StoredLocation {
  city: string;
  neighborhood: string | null;
}

interface LocationContextValue {
  city: string;
  neighborhood: string | null;
  /** Punto de referencia para calcular distancias. */
  origin: Coordinates | null;
  usingDeviceLocation: boolean;
  geoStatus: GeoStatus;
  setCity: (city: string, neighborhood?: string | null) => void;
  setNeighborhood: (neighborhood: string | null) => void;
  requestDeviceLocation: () => void;
  clearDeviceLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

function readStored(): StoredLocation {
  const fallback: StoredLocation = {
    city: findCity(appConfig.defaultCity)?.name ?? CITIES[0].name,
    neighborhood: null,
  };
  if (typeof localStorage === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLocation>;
    const city = findCity(parsed.city)?.name;
    return city ? { city, neighborhood: parsed.neighborhood ?? null } : fallback;
  } catch {
    return fallback;
  }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredLocation>(readStored);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Sin persistencia (modo privado): la selección vive en memoria.
    }
  }, [stored]);

  const setCity = useCallback((city: string, neighborhood: string | null = null) => {
    const resolved = findCity(city);
    if (!resolved) return;
    setStored({ city: resolved.name, neighborhood });
    // Al elegir ciudad a mano se deja de usar el GPS como referencia.
    setDeviceCoords(null);
    setGeoStatus('idle');
  }, []);

  const setNeighborhood = useCallback((neighborhood: string | null) => {
    setStored((current) => ({ ...current, neighborhood }));
  }, []);

  const requestDeviceLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unsupported');
      return;
    }

    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setDeviceCoords(coords);
        setGeoStatus('granted');

        // Salta a la ciudad más cercana para que el listado tenga sentido.
        const nearest = [...CITIES].sort(
          (a, b) =>
            (a.latitude - coords.latitude) ** 2 +
            (a.longitude - coords.longitude) ** 2 -
            ((b.latitude - coords.latitude) ** 2 + (b.longitude - coords.longitude) ** 2),
        )[0];
        if (nearest) setStored({ city: nearest.name, neighborhood: null });
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const clearDeviceLocation = useCallback(() => {
    setDeviceCoords(null);
    setGeoStatus('idle');
  }, []);

  const value = useMemo<LocationContextValue>(() => {
    const cityOption = findCity(stored.city);
    const origin =
      deviceCoords ??
      (cityOption ? { latitude: cityOption.latitude, longitude: cityOption.longitude } : null);

    return {
      city: stored.city,
      neighborhood: stored.neighborhood,
      origin,
      usingDeviceLocation: deviceCoords !== null,
      geoStatus,
      setCity,
      setNeighborhood,
      requestDeviceLocation,
      clearDeviceLocation,
    };
  }, [
    clearDeviceLocation,
    deviceCoords,
    geoStatus,
    requestDeviceLocation,
    setCity,
    setNeighborhood,
    stored,
  ]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useLocation debe usarse dentro de <LocationProvider>');
  return context;
}

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatDistance } from '@/lib/geo';
import { formatRating } from '@/lib/format';
import type { DecoratedShop } from '@/lib/search';
import type { Coordinates } from '@/lib/geo';

const VIEW_WIDTH = 360;
const VIEW_HEIGHT = 240;
const PADDING = 34;

interface ShopMiniMapProps {
  entries: DecoratedShop[];
  origin: Coordinates | null;
  selectedShopId: string | null;
  onSelect: (shopId: string) => void;
  onOpen?: (shopId: string) => void;
  usingDeviceLocation: boolean;
  className?: string;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Generador determinista para que el trazado de calles no cambie en cada render. */
function seededRandom(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function computeBounds(points: Coordinates[]): Bounds {
  const lats = points.map((point) => point.latitude);
  const lons = points.map((point) => point.longitude);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);

  // Un solo punto (o todos alineados): se abre un margen mínimo para que la
  // proyección no divida por cero.
  const minSpan = 0.012;
  if (maxLat - minLat < minSpan) {
    const center = (maxLat + minLat) / 2;
    minLat = center - minSpan / 2;
    maxLat = center + minSpan / 2;
  }
  if (maxLon - minLon < minSpan) {
    const center = (maxLon + minLon) / 2;
    minLon = center - minSpan / 2;
    maxLon = center + minSpan / 2;
  }

  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Mapa esquemático con los talleres del listado.
 *
 * Es un SVG propio (sin dependencias ni tiles externos) que proyecta las
 * coordenadas reales de cada taller, así que las posiciones relativas y las
 * distancias sí son las de verdad. Para cambiar a un mapa con cartografía real
 * basta sustituir este componente por MapLibre/Leaflet: la API (`entries`,
 * `selectedShopId`, `onSelect`) no cambia.
 */
export function ShopMiniMap({
  entries,
  origin,
  selectedShopId,
  onSelect,
  onOpen,
  usingDeviceLocation,
  className,
}: ShopMiniMapProps) {
  const located = useMemo(
    () =>
      entries.filter(
        (entry) => entry.shop.latitude !== null && entry.shop.longitude !== null,
      ),
    [entries],
  );

  const projection = useMemo(() => {
    const points: Coordinates[] = located.map((entry) => ({
      latitude: entry.shop.latitude as number,
      longitude: entry.shop.longitude as number,
    }));
    if (origin) points.push(origin);
    if (points.length === 0) return null;

    const bounds = computeBounds(points);
    const spanLat = bounds.maxLat - bounds.minLat;
    const spanLon = bounds.maxLon - bounds.minLon;

    return (point: Coordinates) => ({
      x: PADDING + ((point.longitude - bounds.minLon) / spanLon) * (VIEW_WIDTH - PADDING * 2),
      // La latitud crece hacia el norte, el eje Y del SVG hacia el sur.
      y:
        VIEW_HEIGHT -
        PADDING -
        ((point.latitude - bounds.minLat) / spanLat) * (VIEW_HEIGHT - PADDING * 2),
    });
  }, [located, origin]);

  const streets = useMemo(() => {
    const random = seededRandom(located.length * 97 + 13);
    const horizontal = Array.from({ length: 5 }, (_, index) => ({
      y: 22 + index * 48 + random() * 14,
      width: random() > 0.7 ? 7 : 3.5,
    }));
    const vertical = Array.from({ length: 6 }, (_, index) => ({
      x: 18 + index * 62 + random() * 18,
      width: random() > 0.75 ? 7 : 3.5,
    }));
    return { horizontal, vertical };
  }, [located.length]);

  const selected = located.find((entry) => entry.shop.id === selectedShopId) ?? null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-card border border-line bg-surface-2',
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="block h-52 w-full"
        role="img"
        aria-label={`Mapa con ${located.length} talleres`}
      >
        <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#eef2f7" />

        {/* Manzanas y calles: trazado esquemático estable. */}
        <g>
          {streets.horizontal.map((street, index) => (
            <rect
              key={`h-${index}`}
              x={0}
              y={street.y}
              width={VIEW_WIDTH}
              height={street.width}
              fill="#ffffff"
            />
          ))}
          {streets.vertical.map((street, index) => (
            <rect
              key={`v-${index}`}
              x={street.x}
              y={0}
              width={street.width}
              height={VIEW_HEIGHT}
              fill="#ffffff"
            />
          ))}
        </g>
        <path
          d={`M0 ${VIEW_HEIGHT - 32} C 90 ${VIEW_HEIGHT - 62}, 210 ${VIEW_HEIGHT - 6}, ${VIEW_WIDTH} ${VIEW_HEIGHT - 46}`}
          stroke="#cffafe"
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
        />

        {projection && origin ? (
          <g>
            <circle
              cx={projection(origin).x}
              cy={projection(origin).y}
              r={16}
              fill="#2563eb"
              opacity={0.14}
            />
            <circle
              cx={projection(origin).x}
              cy={projection(origin).y}
              r={5.5}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={2.5}
            />
          </g>
        ) : null}

        {projection
          ? located.map((entry) => {
              const point = projection({
                latitude: entry.shop.latitude as number,
                longitude: entry.shop.longitude as number,
              });
              const isSelected = entry.shop.id === selectedShopId;
              const isUrgent = entry.shop.acceptsUrgent24h;
              const color = isUrgent ? '#dc2626' : '#2563eb';

              return (
                <g
                  key={entry.shop.id}
                  transform={`translate(${point.x}, ${point.y})`}
                  onClick={() => onSelect(entry.shop.id)}
                  className="cursor-pointer"
                  role="button"
                  aria-label={`${entry.shop.name}${isUrgent ? ', acepta urgencias 24h' : ''}`}
                >
                  <path
                    d="M0 4 C -9 -4, -11 -12, -6.5 -17 A 9 9 0 0 1 6.5 -17 C 11 -12, 9 -4, 0 4 Z"
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={isSelected ? 2.6 : 1.8}
                    transform={isSelected ? 'scale(1.35)' : 'scale(1)'}
                    opacity={selectedShopId && !isSelected ? 0.72 : 1}
                  />
                  <circle cy={-12} r={3.2} fill="#ffffff" transform={isSelected ? 'scale(1.35)' : 'scale(1)'} />
                </g>
              );
            })
          : null}
      </svg>

      <div className="pointer-events-none absolute top-2 left-2 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-medium text-muted shadow-sm">
        {usingDeviceLocation ? 'Tu ubicación en tiempo real' : 'Mapa esquemático de la zona'}
      </div>

      {selected ? (
        <button
          type="button"
          onClick={() => onOpen?.(selected.shop.id)}
          className="absolute inset-x-2 bottom-2 flex items-center gap-3 rounded-xl bg-surface/97 px-3 py-2.5 text-left shadow-float backdrop-blur"
        >
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white',
              selected.shop.acceptsUrgent24h ? 'bg-urgent' : 'bg-accent',
            )}
          >
            {formatRating(selected.shop.ratingAvg)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">
              {selected.shop.name}
            </span>
            <span className="block truncate text-xs text-muted">
              {[
                selected.shop.neighborhood ?? selected.shop.city,
                formatDistance(selected.distanceKm),
                selected.openNow ? 'Abierto' : 'Cerrado',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="text-xs font-semibold text-accent">Ver</span>
        </button>
      ) : null}
    </div>
  );
}

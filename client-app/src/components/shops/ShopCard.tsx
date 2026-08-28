import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { estimateDriveMinutes, formatDistance } from '@/lib/geo';
import type { DecoratedShop } from '@/lib/search';
import { OpenBadge, UrgentBadge } from '@/components/ui/Badge';
import { HeartIcon, PinIcon } from '@/components/ui/Icons';
import { Stars } from '@/components/ui/Stars';
import { PromotionBadges } from '@/components/shops/PromotionList';

interface ShopCardProps {
  entry: DecoratedShop;
  isFavorite: boolean;
  onToggleFavorite: (shopId: string) => void;
  highlighted?: boolean;
  onHighlight?: (shopId: string) => void;
}

/**
 * Tarjeta de taller del listado: nombre, valoración, distancia, estado de
 * apertura y distintivo de urgencias 24h.
 */
export function ShopCard({
  entry,
  isFavorite,
  onToggleFavorite,
  highlighted = false,
  onHighlight,
}: ShopCardProps) {
  const { shop, distanceKm, openNow, openLabel } = entry;
  const distance = formatDistance(distanceKm);
  const cheapest = shop.services
    .map((service) => service.priceFrom)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b)[0];

  return (
    <article
      onMouseEnter={() => onHighlight?.(shop.id)}
      className={cn(
        'relative rounded-card border bg-surface p-4 transition-shadow',
        highlighted ? 'border-accent shadow-card' : 'border-line hover:shadow-card',
      )}
    >
      <button
        type="button"
        onClick={() => onToggleFavorite(shop.id)}
        aria-label={isFavorite ? `Quitar ${shop.name} de favoritos` : `Guardar ${shop.name} en favoritos`}
        aria-pressed={isFavorite}
        className={cn(
          'absolute top-3 right-3 grid size-9 place-items-center rounded-full transition-colors',
          isFavorite ? 'text-urgent' : 'text-line-strong hover:text-muted',
        )}
      >
        <HeartIcon filled={isFavorite} className="size-5" />
      </button>

      <Link to={`/taller/${shop.id}`} className="block pr-10">
        <div className="flex items-start gap-3">
          {shop.coverImageUrl ? (
            <img
              src={shop.coverImageUrl}
              alt=""
              width={44}
              height={44}
              className="size-11 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold',
                shop.acceptsUrgent24h ? 'bg-urgent-soft text-urgent' : 'bg-accent-soft text-accent',
              )}
            >
              {shop.name
                .split(' ')
                .filter((word) => word.length > 2)
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase())
                .join('')}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] leading-tight font-semibold text-ink">
              {shop.name}
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <Stars rating={shop.ratingAvg} count={shop.ratingCount} />
            </div>
          </div>
        </div>

        {shop.headline ? (
          <p className="mt-2.5 line-clamp-2 text-[13px] text-ink-2">{shop.headline}</p>
        ) : null}

        <PromotionBadges promotions={shop.promotions} />

        <p className="mt-2 flex items-center gap-1 text-[13px] text-muted">
          <PinIcon className="size-4 shrink-0" />
          <span className="truncate">
            {[shop.neighborhood, shop.city].filter(Boolean).join(' · ') || shop.address}
          </span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <OpenBadge openNow={openNow} label={openLabel} />
          {distance ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">
              {distance}
              {distanceKm !== null ? (
                <span className="font-normal text-muted">
                  · {estimateDriveMinutes(distanceKm)} min
                </span>
              ) : null}
            </span>
          ) : null}
          {shop.acceptsUrgent24h ? <UrgentBadge /> : null}
          {cheapest !== undefined ? (
            <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
              desde {cheapest} €
            </span>
          ) : null}
        </div>
      </Link>
    </article>
  );
}

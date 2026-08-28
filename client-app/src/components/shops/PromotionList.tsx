import type { ShopPromotion } from '@/data/types';
import { formatPrice, formatPriceRange } from '@/lib/format';
import { cn } from '@/lib/cn';

interface PromotionListProps {
  promotions: ShopPromotion[];
  className?: string;
}

export function PromotionList({ promotions, className }: PromotionListProps) {
  if (promotions.length === 0) return null;

  return (
    <ul className={cn('space-y-2.5', className)}>
      {promotions.map((promo) => {
        const price =
          promo.priceFrom != null || promo.priceTo != null
            ? formatPriceRange(promo.priceFrom, promo.priceTo)
            : null;
        const discount =
          promo.discountPercent != null ? `−${Math.round(promo.discountPercent)}%` : null;

        return (
          <li
            key={promo.id}
            className="rounded-card border border-accent/20 bg-accent-soft/60 px-3.5 py-3"
          >
            <div className="flex items-start gap-2.5">
              <span className="inline-flex shrink-0 items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
                {promo.badgeLabel ?? discount ?? 'Oferta'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">{promo.title}</p>
                {promo.description ? (
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{promo.description}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                  {promo.serviceName ? <span>{promo.serviceName}</span> : null}
                  {price ? <span className="font-semibold text-accent">{price}</span> : null}
                  {discount && promo.badgeLabel ? (
                    <span className="font-semibold text-accent">{discount}</span>
                  ) : null}
                  {!price && !discount && promo.priceFrom != null ? (
                    <span className="font-semibold text-accent">{formatPrice(promo.priceFrom)}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PromotionBadges({ promotions }: { promotions: ShopPromotion[] }) {
  if (promotions.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {promotions.slice(0, 2).map((promo) => (
        <span
          key={promo.id}
          className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent"
        >
          {promo.badgeLabel ??
            (promo.discountPercent != null
              ? `−${Math.round(promo.discountPercent)}%`
              : promo.title)}
        </span>
      ))}
    </div>
  );
}

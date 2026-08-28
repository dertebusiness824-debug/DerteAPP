import { cn } from '@/lib/cn';
import { formatRating } from '@/lib/format';

interface StarsProps {
  rating: number;
  count?: number;
  size?: 'sm' | 'md';
  showValue?: boolean;
  className?: string;
}

/** Valoración en estrellas con relleno parcial (4,6 → cuatro y media). */
export function Stars({ rating, count, size = 'sm', showValue = true, className }: StarsProps) {
  const starSize = size === 'sm' ? 'size-3.5' : 'size-4';
  const percentage = Math.max(0, Math.min(100, (rating / 5) * 100));

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative inline-flex" aria-hidden="true">
        <span className="inline-flex text-surface-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <Star key={index} className={starSize} />
          ))}
        </span>
        <span
          className="absolute inset-y-0 left-0 inline-flex overflow-hidden text-warn"
          style={{ width: `${percentage}%` }}
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <Star key={index} className={starSize} />
          ))}
        </span>
      </span>

      {showValue ? (
        <span className="text-xs font-semibold text-ink">{formatRating(rating)}</span>
      ) : null}
      {count !== undefined ? <span className="text-xs text-muted">({count})</span> : null}
      <span className="sr-only">
        {formatRating(rating)} de 5{count !== undefined ? ` con ${count} opiniones` : ''}
      </span>
    </span>
  );
}

function Star({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} fill="currentColor">
      <path d="M12 2.5l2.9 6.05 6.6.86-4.8 4.6 1.2 6.55L12 17.45 6.1 20.56l1.2-6.55-4.8-4.6 6.6-.86z" />
    </svg>
  );
}

interface StarPickerProps {
  value: number;
  onChange: (value: number) => void;
}

/** Selector de estrellas para publicar una opinión. */
export function StarPicker({ value, onChange }: StarPickerProps) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          aria-label={`${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
          aria-pressed={value === star}
          className={cn(
            'grid size-10 place-items-center rounded-lg transition-colors',
            star <= value ? 'text-warn' : 'text-surface-3 hover:text-line-strong',
          )}
        >
          <Star className="size-7" />
        </button>
      ))}
    </div>
  );
}

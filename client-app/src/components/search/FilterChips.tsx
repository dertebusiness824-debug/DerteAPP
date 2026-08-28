import { cn } from '@/lib/cn';
import { SERVICE_CATEGORIES, type ShopFilters, type ShopSort } from '@/lib/search';
import { BoltIcon, ClockIcon } from '@/components/ui/Icons';

interface FilterChipsProps {
  filters: ShopFilters;
  onChange: (patch: Partial<ShopFilters>) => void;
}

/** Filtros rápidos: servicio, abierto ahora y urgencias 24h. */
export function FilterChips({ filters, onChange }: FilterChipsProps) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 no-scrollbar">
      <div className="flex w-max items-center gap-2 pb-0.5">
        <Chip
          active={filters.onlyOpen}
          onClick={() => onChange({ onlyOpen: !filters.onlyOpen })}
          icon={<ClockIcon className="size-4" />}
        >
          Abierto ahora
        </Chip>
        <Chip
          active={filters.onlyUrgent}
          tone="urgent"
          onClick={() => onChange({ onlyUrgent: !filters.onlyUrgent })}
          icon={<BoltIcon className="size-4" />}
        >
          Urgencias 24h
        </Chip>

        <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-line" />

        {SERVICE_CATEGORIES.map((category) => (
          <Chip
            key={category.slug}
            active={filters.serviceSlug === category.slug}
            onClick={() =>
              onChange({
                serviceSlug: filters.serviceSlug === category.slug ? null : category.slug,
              })
            }
          >
            {category.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'accent' | 'urgent';
}

function Chip({ active, onClick, children, icon, tone = 'accent' }: ChipProps) {
  const activeStyles =
    tone === 'urgent'
      ? 'border-urgent bg-urgent-soft text-urgent'
      : 'border-accent bg-accent-soft text-accent';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
        active ? activeStyles : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

interface SortToggleProps {
  value: ShopSort;
  onChange: (sort: ShopSort) => void;
}

export function SortToggle({ value, onChange }: SortToggleProps) {
  const options: Array<{ value: ShopSort; label: string }> = [
    { value: 'distance', label: 'Cercanía' },
    { value: 'rating', label: 'Valoración' },
    { value: 'urgent', label: 'Urgencias' },
  ];

  return (
    <div className="inline-flex rounded-full bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
            value === option.value ? 'bg-surface text-ink shadow-sm' : 'text-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

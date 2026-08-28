import type { WeeklyHour } from '@/data/types';
import { cn } from '@/lib/cn';
import { formatRange, WEEKDAY_LABELS, weekOrder } from '@/lib/hours';
import { zonedParts } from '@/lib/time';

interface ShopHoursListProps {
  hours: WeeklyHour[];
  timezone: string;
}

/** Horario semanal detallado, de lunes a domingo, con el día de hoy resaltado. */
export function ShopHoursList({ hours, timezone }: ShopHoursListProps) {
  if (hours.length === 0) {
    return <p className="text-sm text-muted">Este taller todavía no ha publicado su horario.</p>;
  }

  const todayWeekday = zonedParts(new Date(), timezone).weekday;

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
      {weekOrder(hours).map((entry) => {
        const range = formatRange(entry);
        const isToday = entry.weekday === todayWeekday;

        return (
          <li
            key={entry.weekday}
            className={cn(
              'flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]',
              isToday && 'bg-accent-soft',
            )}
          >
            <span className={cn(isToday ? 'font-semibold text-accent' : 'text-ink-2')}>
              {WEEKDAY_LABELS[entry.weekday]}
              {isToday ? <span className="ml-1.5 text-[11px] font-medium">hoy</span> : null}
            </span>
            <span
              className={cn(
                'text-right tabular-nums',
                range ? (isToday ? 'font-semibold text-accent' : 'text-ink') : 'text-muted',
              )}
            >
              {range ?? 'Cerrado'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

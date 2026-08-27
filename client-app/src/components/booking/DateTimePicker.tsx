import { cn } from '@/lib/cn';
import { WEEKDAY_SHORT } from '@/lib/hours';
import type { DayAvailability } from '@/lib/slots';
import { Skeleton } from '@/components/ui/States';

interface DateTimePickerProps {
  calendar: DayAvailability[];
  loading: boolean;
  selectedDateKey: string | null;
  onSelectDay: (dateKey: string) => void;
  selectedIso: string | null;
  onSelectSlot: (iso: string) => void;
}

/**
 * Selector de fecha y hora construido sobre la disponibilidad real: cada día
 * muestra cuántos huecos quedan y las horas ya ocupadas aparecen tachadas.
 */
export function DateTimePicker({
  calendar,
  loading,
  selectedDateKey,
  onSelectDay,
  selectedIso,
  onSelectSlot,
}: DateTimePickerProps) {
  const selectedDay =
    calendar.find((day) => day.dateKey === selectedDateKey) ?? calendar[0] ?? null;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[68px] w-full" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="-mx-5 overflow-x-auto px-5 no-scrollbar">
        <div className="flex w-max gap-2 pb-1">
          {calendar.map((day, index) => (
            <DayChip
              key={day.dateKey}
              day={day}
              index={index}
              active={day.dateKey === selectedDay?.dateKey}
              onClick={() => onSelectDay(day.dateKey)}
            />
          ))}
        </div>
      </div>

      {!selectedDay || selectedDay.slots.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
          {selectedDay?.isClosed
            ? 'El taller cierra este día. Elige otra fecha.'
            : 'No hay horas publicadas para este día.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            {selectedDay.slots.map((slot) => (
              <button
                key={slot.iso}
                type="button"
                disabled={!slot.available}
                onClick={() => onSelectSlot(slot.iso)}
                aria-pressed={slot.iso === selectedIso}
                title={
                  slot.blockedReason === 'full'
                    ? 'Sin plazas a esta hora'
                    : slot.blockedReason === 'notice'
                      ? 'Demasiado pronto para reservar'
                      : `${slot.remaining} plaza(s) libre(s)`
                }
                className={cn(
                  'h-10 rounded-xl border text-[13px] font-semibold transition-colors',
                  slot.iso === selectedIso
                    ? 'border-accent bg-accent text-white'
                    : slot.available
                      ? 'border-line bg-surface text-ink hover:border-accent hover:bg-accent-soft'
                      : 'cursor-not-allowed border-line bg-surface-2 text-muted/60 line-through',
                )}
              >
                {slot.time}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted">
            {selectedDay.availableCount > 0
              ? `${selectedDay.availableCount} hueco${
                  selectedDay.availableCount === 1 ? '' : 's'
                } libre${selectedDay.availableCount === 1 ? '' : 's'} · las horas tachadas ya están ocupadas en la agenda del taller.`
              : 'Este día está completo. Prueba con otra fecha.'}
          </p>
        </>
      )}
    </div>
  );
}

function DayChip({
  day,
  index,
  active,
  onClick,
}: {
  day: DayAvailability;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const label = index === 0 ? 'Hoy' : index === 1 ? 'Mañana' : WEEKDAY_SHORT[day.weekday];
  const dayNumber = Number(day.dateKey.slice(-2));
  const disabled = day.availableCount === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex w-[62px] shrink-0 flex-col items-center gap-0.5 rounded-xl border py-2 transition-colors',
        active
          ? 'border-accent bg-accent-soft'
          : disabled
            ? 'border-line bg-surface-2 opacity-60'
            : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span
        className={cn('text-[11px] font-medium', active ? 'text-accent' : 'text-muted')}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-[17px] leading-none font-semibold',
          active ? 'text-accent' : disabled ? 'text-muted' : 'text-ink',
        )}
      >
        {dayNumber}
      </span>
      <span
        className={cn(
          'text-[10px]',
          disabled ? 'text-muted' : active ? 'text-accent' : 'text-ok',
        )}
      >
        {disabled ? '—' : `${day.availableCount} libres`}
      </span>
    </button>
  );
}

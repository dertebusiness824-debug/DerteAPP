import { useState } from 'react';
import type { ShopService } from '@/data/types';
import { formatPriceRange } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { ChevronDownIcon } from '@/components/ui/Icons';

const COLLAPSED_COUNT = 5;

interface ServiceListProps {
  services: ShopService[];
  slotMinutes: number;
  onBook: (serviceId: string) => void;
}

/** Servicios del taller con precios orientativos y reserva directa. */
export function ServiceList({ services, slotMinutes, onBook }: ServiceListProps) {
  const [expanded, setExpanded] = useState(false);

  if (services.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line-strong px-4 py-5 text-center text-sm text-muted">
        Este taller aún no ha publicado su tarifa. Reserva una cita y te dará presupuesto sin coste.
      </p>
    );
  }

  const visible = expanded ? services : services.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {visible.map((service) => (
          <li key={service.id} className="flex items-center gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-tight font-medium text-ink">{service.name}</p>
              {service.description ? (
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{service.description}</p>
              ) : null}
              <p className="mt-1 text-[13px]">
                <span className="font-semibold text-accent">
                  {formatPriceRange(service.priceFrom, service.priceTo)}
                </span>
                <span className="ml-1.5 text-muted">
                  · {service.durationMinutes ?? slotMinutes} min
                </span>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onBook(service.id)}>
              Reservar
            </Button>
          </li>
        ))}
      </ul>

      {services.length > COLLAPSED_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full items-center justify-center gap-1 py-1 text-[13px] font-semibold text-accent"
        >
          {expanded
            ? 'Ver menos servicios'
            : `Ver los ${services.length} servicios y precios`}
          <ChevronDownIcon
            className={expanded ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'}
          />
        </button>
      ) : null}

      <p className="text-xs text-muted">
        Precios orientativos publicados por el taller. El presupuesto final se confirma tras revisar
        el vehículo.
      </p>
    </div>
  );
}

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { CITIES, findCity } from '@/lib/geo';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { CheckIcon, ChevronDownIcon, NavigationIcon, PinIcon } from '@/components/ui/Icons';
import { useLocation } from '@/providers/LocationProvider';

/** Selector de ciudad y barrio, con opción de usar el GPS del dispositivo. */
export function LocationPicker() {
  const {
    city,
    neighborhood,
    setCity,
    setNeighborhood,
    requestDeviceLocation,
    usingDeviceLocation,
    geoStatus,
  } = useLocation();
  const [open, setOpen] = useState(false);
  const neighborhoods = findCity(city)?.neighborhoods ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-left"
      >
        <PinIcon className="size-4 shrink-0 text-accent" />
        <span className="min-w-0">
          <span className="block text-[11px] leading-none text-muted">Buscando en</span>
          <span className="block truncate text-[13px] leading-tight font-semibold text-ink">
            {neighborhood ? `${neighborhood}, ${city}` : city}
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted" />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="¿Dónde buscamos taller?"
        subtitle="Elige tu ciudad y, si quieres, el barrio."
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Button
              variant="outline"
              fullWidth
              icon={<NavigationIcon className="size-4 text-accent" />}
              loading={geoStatus === 'locating'}
              onClick={() => {
                requestDeviceLocation();
                setOpen(false);
              }}
            >
              {usingDeviceLocation ? 'Actualizar mi ubicación' : 'Usar mi ubicación actual'}
            </Button>
            {geoStatus === 'denied' ? (
              <p className="text-xs text-urgent">
                No pudimos acceder a tu ubicación. Revisa los permisos del navegador o elige la
                ciudad a mano.
              </p>
            ) : null}
            {geoStatus === 'unsupported' ? (
              <p className="text-xs text-muted">
                Este navegador no permite geolocalización. Elige la ciudad a mano.
              </p>
            ) : null}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Ciudades con talleres
            </h3>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
              {CITIES.map((option) => (
                <li key={option.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setCity(option.name);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {option.name}
                      </span>
                      <span className="block truncate text-xs text-muted">{option.region}</span>
                    </span>
                    {option.name === city ? <CheckIcon className="size-5 text-accent" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {neighborhoods.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                Barrios de {city}
              </h3>
              <div className="flex flex-wrap gap-2">
                <NeighborhoodChip
                  label="Toda la ciudad"
                  active={neighborhood === null}
                  onClick={() => setNeighborhood(null)}
                />
                {neighborhoods.map((option) => (
                  <NeighborhoodChip
                    key={option}
                    label={option}
                    active={neighborhood === option}
                    onClick={() => setNeighborhood(option)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

function NeighborhoodChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

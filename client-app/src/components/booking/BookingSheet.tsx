import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ShopDetail, ShopService, Vehicle } from '@/data/types';
import { cn } from '@/lib/cn';
import {
  formatDateTime,
  formatList,
  formatPlate,
  formatPriceRange,
  normalizePlateForStorage,
} from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { CarIcon, CheckIcon, ClockIcon, WrenchIcon } from '@/components/ui/Icons';
import { Sheet } from '@/components/ui/Sheet';
import { InlineError } from '@/components/ui/States';
import { useAvailability } from '@/hooks/useAvailability';
import { useActivity } from '@/providers/ActivityProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';
import { DateTimePicker } from './DateTimePicker';

type Step = 'service' | 'schedule' | 'details' | 'done';

const STEP_TITLES: Record<Step, string> = {
  service: '¿Qué necesita tu coche?',
  schedule: 'Elige día y hora',
  details: 'Tu vehículo y contacto',
  done: 'Reserva confirmada',
};

interface BookingSheetProps {
  shop: ShopDetail;
  open: boolean;
  onClose: () => void;
  /** Servicio preseleccionado al abrir desde la lista de precios. */
  initialServiceId?: string | null;
}

interface Confirmation {
  reference: string | null;
  scheduledAt: string;
  statusLabel: string;
  serviceName: string | null;
}

/**
 * Flujo completo de reserva: servicio → fecha y hora reales → datos del
 * vehículo → confirmación. Al confirmar, el registro entra en Supabase (RPC
 * `marketplace_create_booking`) y aparece en la agenda del taller en derteapp.
 */
export function BookingSheet({ shop, open, onClose, initialServiceId = null }: BookingSheetProps) {
  const navigate = useNavigate();
  const { createBooking } = useActivity();
  const { profile, vehicles, isSignedIn, requestAuth, saveVehicle } = useSession();
  const { notify } = useToast();

  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState<string | null>(initialServiceId);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const service = useMemo(
    () => shop.services.find((entry) => entry.id === serviceId) ?? null,
    [serviceId, shop.services],
  );

  const duration = service?.durationMinutes ?? shop.slotMinutes;
  const { calendar, loading, error: availabilityError, firstOpenDay, refresh } = useAvailability(
    open ? shop : null,
    duration,
  );

  useEffect(() => {
    if (!open) return;
    setStep('service');
    setServiceId(initialServiceId);
    setScheduledAt(null);
    setDateKey(null);
    setError(null);
    setConfirmation(null);
    setNotes('');
  }, [initialServiceId, open, shop.id]);

  useEffect(() => {
    if (!open) return;
    setName((current) => current || profile?.fullName || '');
    setPhone((current) => current || profile?.phone || '');
  }, [open, profile]);

  const applyVehicle = useCallback((vehicle: Vehicle) => {
    setMake(vehicle.make);
    setModel(vehicle.model);
    setPlate(formatPlate(vehicle.plate));
  }, []);

  // El vehículo habitual se rellena una sola vez por apertura, para no pisar lo
  // que el conductor esté escribiendo.
  const vehiclePrefilled = useRef(false);
  useEffect(() => {
    if (!open) {
      vehiclePrefilled.current = false;
      return;
    }
    if (vehiclePrefilled.current) return;
    const preferred = vehicles.find((entry) => entry.isDefault) ?? vehicles[0];
    if (!preferred) return;
    vehiclePrefilled.current = true;
    applyVehicle(preferred);
  }, [applyVehicle, open, vehicles]);

  // El calendario se preselecciona en el primer día con hueco libre.
  useEffect(() => {
    if (dateKey || !firstOpenDay) return;
    setDateKey(firstOpenDay.dateKey);
  }, [dateKey, firstOpenDay]);

  const missingDetails = [
    make.trim().length > 1 ? null : 'la marca',
    model.trim().length > 0 ? null : 'el modelo',
    normalizePlateForStorage(plate).length >= 4 ? null : 'la matrícula',
    name.trim().length > 1 ? null : 'tu nombre',
    phone.trim().length >= 6 ? null : 'el teléfono',
  ].filter((field): field is string => field !== null);
  const detailsComplete = missingDetails.length === 0;

  const confirm = async () => {
    if (!scheduledAt) return;
    if (!isSignedIn) {
      requestAuth('Entra en tu cuenta para confirmar la reserva');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await createBooking({
        shopId: shop.id,
        scheduledAt,
        serviceName: service?.name ?? 'Consulta general',
        priceEstimate: service?.priceFrom ?? null,
        durationMinutes: duration,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerEmail: profile?.email ?? null,
        vehicleMake: make.trim(),
        vehicleModel: model.trim(),
        vehiclePlate: normalizePlateForStorage(plate),
        vehicleYear: null,
        notes: notes.trim() || null,
      });

      if (remember) {
        // El vehículo queda guardado para la próxima reserva.
        try {
          await saveVehicle({
            make: make.trim(),
            model: model.trim(),
            plate: normalizePlateForStorage(plate),
            year: null,
            fuel: null,
            isDefault: vehicles.length === 0,
          });
        } catch {
          // Guardar el vehículo es un extra: la cita ya está creada.
        }
      }

      setConfirmation({
        reference: result.reference,
        scheduledAt: result.scheduledAt,
        statusLabel: result.status === 'pending' ? 'Pendiente de confirmar' : 'Aceptada',
        serviceName: service?.name ?? 'Consulta general',
      });
      setStep('done');
      notify('Cita enviada al taller', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No pudimos crear la reserva.';
      setError(message);
      // Un hueco pisado por otro cliente: se recarga la ocupación real.
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const footer = (() => {
    if (step === 'done') {
      return (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            onClick={() => {
              onClose();
              navigate('/citas');
            }}
          >
            Ver mis citas
          </Button>
        </div>
      );
    }

    if (step === 'service') {
      return (
        <Button fullWidth onClick={() => setStep('schedule')}>
          Continuar
        </Button>
      );
    }

    if (step === 'schedule') {
      return (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button variant="outline" onClick={() => setStep('service')}>
            Atrás
          </Button>
          <Button disabled={!scheduledAt} onClick={() => setStep('details')}>
            {scheduledAt
              ? `Continuar · ${formatDateTime(scheduledAt, shop.timezone)}`
              : 'Elige una hora'}
          </Button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="outline" onClick={() => setStep('schedule')}>
          Atrás
        </Button>
        <Button loading={pending} disabled={!detailsComplete} onClick={() => void confirm()}>
          Confirmar reserva
        </Button>
      </div>
    );
  })();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={STEP_TITLES[step]}
      subtitle={step === 'done' ? shop.name : `${shop.name} · ${shop.city ?? ''}`.trim()}
      footer={footer}
    >
      {step !== 'done' ? <StepDots step={step} /> : null}

      {error ? (
        <div className="mb-4">
          <InlineError message={error} />
        </div>
      ) : null}

      {step === 'service' ? (
        <ServiceStep
          services={shop.services}
          selectedId={serviceId}
          onSelect={setServiceId}
          slotMinutes={shop.slotMinutes}
        />
      ) : null}

      {step === 'schedule' ? (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <ClockIcon className="size-4 shrink-0" />
            {service
              ? `${service.name} · ${duration} min`
              : `Consulta general · ${duration} min`}
          </p>
          {availabilityError ? <InlineError message={availabilityError} /> : null}
          <DateTimePicker
            calendar={calendar}
            loading={loading}
            selectedDateKey={dateKey}
            onSelectDay={(key) => {
              setDateKey(key);
              setScheduledAt(null);
            }}
            selectedIso={scheduledAt}
            onSelectSlot={setScheduledAt}
          />
        </div>
      ) : null}

      {step === 'details' ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-card bg-accent-soft px-3.5 py-3">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
            <div className="text-[13px]">
              <p className="font-semibold text-ink">
                {scheduledAt ? formatDateTime(scheduledAt, shop.timezone) : ''}
              </p>
              <p className="text-ink-2">{service?.name ?? 'Consulta general'}</p>
            </div>
          </div>

          {vehicles.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink-2">Mis vehículos</p>
              <div className="flex flex-wrap gap-2">
                {vehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => applyVehicle(vehicle)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                      normalizePlateForStorage(plate) === normalizePlateForStorage(vehicle.plate)
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line bg-surface text-ink-2',
                    )}
                  >
                    <CarIcon className="size-4" />
                    {vehicle.make} {vehicle.model}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Marca"
              required
              placeholder="Seat"
              value={make}
              onChange={(event) => setMake(event.target.value)}
            />
            <TextField
              label="Modelo"
              required
              placeholder="León 1.5 TSI"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
          <TextField
            label="Matrícula"
            required
            placeholder="1234 ABC"
            autoCapitalize="characters"
            value={plate}
            onChange={(event) => setPlate(event.target.value.toUpperCase())}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Tu nombre"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="Teléfono"
              required
              type="tel"
              autoComplete="tel"
              placeholder="600 123 456"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>

          <TextAreaField
            label="Cuéntale al taller qué le pasa"
            hint="Opcional: ruidos, testigos encendidos, cuándo empezó…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />

          <label className="flex items-start gap-2.5 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="mt-0.5 size-4 rounded border-line-strong text-accent focus:ring-accent/30"
            />
            Guardar este vehículo en mi perfil
          </label>

          {detailsComplete ? null : (
            <p className="text-[13px] text-muted" role="status">
              Para confirmar la cita falta {formatList(missingDetails)}.
            </p>
          )}
        </div>
      ) : null}

      {step === 'done' && confirmation ? (
        <div className="space-y-4 py-1 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-ok-soft text-ok">
            <CheckIcon className="size-8" />
          </span>
          <div className="space-y-1">
            <p className="text-[17px] font-semibold text-ink">
              {formatDateTime(confirmation.scheduledAt, shop.timezone)}
            </p>
            <p className="text-sm text-muted">
              {confirmation.serviceName} en {shop.name}
            </p>
          </div>

          <dl className="space-y-2 rounded-card border border-line bg-surface-2/60 px-4 py-3 text-left text-[13px]">
            <Row label="Estado" value={confirmation.statusLabel} />
            {confirmation.reference ? (
              <Row label="Referencia" value={confirmation.reference} mono />
            ) : null}
            <Row label="Vehículo" value={`${make} ${model} · ${formatPlate(plate)}`} />
            {shop.address ? <Row label="Dirección" value={shop.address} /> : null}
            {shop.phone ? <Row label="Teléfono del taller" value={shop.phone} /> : null}
          </dl>

          <p className="text-[13px] text-muted">
            La cita ya está en la agenda del taller. Si cambia el estado lo verás al instante en
            «Mis citas».
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={cn('text-right font-medium text-ink', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['service', 'schedule', 'details'];
  const current = order.indexOf(step);

  return (
    <ol className="mb-4 flex items-center gap-1.5" aria-label="Progreso de la reserva">
      {order.map((entry, index) => (
        <li
          key={entry}
          aria-current={entry === step ? 'step' : undefined}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors',
            index <= current ? 'bg-accent' : 'bg-surface-3',
          )}
        />
      ))}
    </ol>
  );
}

interface ServiceStepProps {
  services: ShopService[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  slotMinutes: number;
}

function ServiceStep({ services, selectedId, onSelect, slotMinutes }: ServiceStepProps) {
  return (
    <ul className="space-y-2">
      {services.map((service) => (
        <li key={service.id}>
          <button
            type="button"
            onClick={() => onSelect(service.id)}
            aria-pressed={selectedId === service.id}
            className={cn(
              'flex w-full items-start gap-3 rounded-card border px-3.5 py-3 text-left transition-colors',
              selectedId === service.id
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-surface hover:bg-surface-2',
            )}
          >
            <WrenchIcon
              className={cn(
                'mt-0.5 size-5 shrink-0',
                selectedId === service.id ? 'text-accent' : 'text-muted',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">{service.name}</span>
              {service.description ? (
                <span className="mt-0.5 block text-[13px] text-muted">{service.description}</span>
              ) : null}
              <span className="mt-1 block text-[13px] font-semibold text-accent">
                {formatPriceRange(service.priceFrom, service.priceTo)}
                <span className="ml-1.5 font-normal text-muted">
                  · {service.durationMinutes ?? slotMinutes} min
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}

      <li>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selectedId === null}
          className={cn(
            'flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-left transition-colors',
            selectedId === null
              ? 'border-accent bg-accent-soft'
              : 'border-line bg-surface hover:bg-surface-2',
          )}
        >
          <ClockIcon
            className={cn('size-5 shrink-0', selectedId === null ? 'text-accent' : 'text-muted')}
          />
          <span>
            <span className="block text-[15px] font-semibold text-ink">Otra cosa / no lo sé</span>
            <span className="block text-[13px] text-muted">
              El taller lo revisa y te da presupuesto.
            </span>
          </span>
        </button>
      </li>
    </ul>
  );
}

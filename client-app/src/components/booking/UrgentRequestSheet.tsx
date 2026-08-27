import { useEffect, useMemo, useState } from 'react';
import { appConfig } from '@/config';
import type { ShopDetail, Vehicle } from '@/data/types';
import { cn } from '@/lib/cn';
import { formatPlate, normalizePlateForStorage } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { BoltIcon, CarIcon, PhoneIcon, ShieldIcon } from '@/components/ui/Icons';
import { Sheet } from '@/components/ui/Sheet';
import { InlineError } from '@/components/ui/States';
import { useActivity } from '@/providers/ActivityProvider';
import { useLocation } from '@/providers/LocationProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

/** Motivos habituales de una asistencia urgente. */
const REASONS = [
  'No arranca',
  'Avería en carretera',
  'Pinchazo o rueda reventada',
  'Sobrecalentamiento',
  'Accidente leve',
  'Batería descargada',
] as const;

interface UrgentRequestSheetProps {
  shop: ShopDetail;
  open: boolean;
  onClose: () => void;
}

interface UrgentConfirmation {
  reachedB2bPanel: boolean;
  shopPhone: string | null;
}

/**
 * Solicitud de asistencia urgente. Llama al RPC
 * `marketplace_create_urgent_request`, que escribe en la tabla `urgencias` del
 * B2B: la alerta salta en el panel de urgencias del taller igual que las que
 * crean los propios talleres.
 */
export function UrgentRequestSheet({ shop, open, onClose }: UrgentRequestSheetProps) {
  const { createUrgentRequest } = useActivity();
  const { profile, vehicles, isSignedIn, requestAuth } = useSession();
  const { city, neighborhood } = useLocation();
  const { notify } = useToast();

  const [reason, setReason] = useState<string>(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [locationText, setLocationText] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<UrgentConfirmation | null>(null);

  const defaultVehicle = useMemo<Vehicle | undefined>(
    () => vehicles.find((entry) => entry.isDefault) ?? vehicles[0],
    [vehicles],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmation(null);
    setName((current) => current || profile?.fullName || '');
    setPhone((current) => current || profile?.phone || '');
    setLocationText((current) => current || [neighborhood, city].filter(Boolean).join(', '));
    if (defaultVehicle) {
      setMake((current) => current || defaultVehicle.make);
      setModel((current) => current || defaultVehicle.model);
      setPlate((current) => current || formatPlate(defaultVehicle.plate));
    }
  }, [city, defaultVehicle, neighborhood, open, profile]);

  const canSubmit = phone.trim().length >= 6 && name.trim().length > 1 && !pending;

  const submit = async () => {
    if (!isSignedIn) {
      requestAuth('Entra en tu cuenta para avisar al taller');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await createUrgentRequest({
        shopId: shop.id,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        reason: [reason, detail.trim()].filter(Boolean).join(' — '),
        locationText: locationText.trim() || null,
        vehicleMake: make.trim() || null,
        vehicleModel: model.trim() || null,
        vehiclePlate: plate.trim() ? normalizePlateForStorage(plate) : null,
      });

      setConfirmation({ reachedB2bPanel: result.reachedB2bPanel, shopPhone: result.shopPhone });
      notify('Aviso enviado al taller', 'urgent');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos enviar la solicitud.');
    } finally {
      setPending(false);
    }
  };

  const callPhone = confirmation?.shopPhone ?? shop.phone ?? appConfig.urgentPhone;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tone="urgent"
      title={confirmation ? 'Aviso enviado' : 'Solicitar asistencia urgente'}
      subtitle={
        confirmation
          ? `${shop.name} ya tiene tu aviso`
          : 'El taller recibe la alerta al instante en su panel de urgencias.'
      }
      footer={
        confirmation ? (
          <div className={cn('grid gap-2', callPhone ? 'grid-cols-2' : 'grid-cols-1')}>
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
            {callPhone ? (
              <a
                href={`tel:${callPhone.replace(/\s+/g, '')}`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-urgent px-4 text-[15px] font-semibold text-white"
              >
                <PhoneIcon className="size-4" />
                Llamar ahora
              </a>
            ) : null}
          </div>
        ) : (
          <Button
            variant="urgent"
            fullWidth
            loading={pending}
            disabled={!canSubmit}
            icon={<BoltIcon className="size-4" />}
            onClick={() => void submit()}
          >
            Enviar aviso urgente
          </Button>
        )
      }
    >
      {confirmation ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-card border border-urgent/25 bg-urgent-soft px-4 py-3">
            <span className="animate-urgent-pulse mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-urgent text-white">
              <BoltIcon className="size-5" />
            </span>
            <div className="text-[13px]">
              <p className="font-semibold text-urgent-strong">Urgencia registrada</p>
              <p className="mt-0.5 text-ink-2">
                {confirmation.reachedB2bPanel
                  ? 'La alerta ya suena en el panel de urgencias del taller. Te llamarán al teléfono que has indicado.'
                  : 'Hemos guardado tu aviso y el taller lo verá en su listado. Si es muy grave, llámale directamente.'}
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-card border border-line bg-surface-2/60 px-4 py-3 text-[13px]">
            <p className="font-semibold text-ink">Qué hemos enviado</p>
            <p className="text-ink-2">{reason}{detail.trim() ? ` — ${detail.trim()}` : ''}</p>
            {locationText.trim() ? (
              <p className="text-muted">Ubicación: {locationText.trim()}</p>
            ) : null}
            {make || model ? (
              <p className="text-muted">
                Vehículo: {[make, model].filter(Boolean).join(' ')}
                {plate ? ` · ${formatPlate(plate)}` : ''}
              </p>
            ) : null}
            <p className="text-muted">Contacto: {name} · {phone}</p>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldIcon className="mt-0.5 size-4 shrink-0" />
            Puedes seguir el estado del aviso en «Mis citas». Si el taller la acepta, lo verás al
            instante.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? <InlineError message={error} /> : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink-2">¿Qué ha pasado?</p>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReason(option)}
                  aria-pressed={reason === option}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                    reason === option
                      ? 'border-urgent bg-urgent-soft text-urgent'
                      : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <TextAreaField
            label="Detalles para el taller"
            hint="Opcional pero ayuda: humo, ruidos, si el coche se mueve…"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />

          <TextField
            label="¿Dónde estás?"
            hint="Calle, kilómetro o punto de referencia."
            placeholder="M-30 salida 12, Madrid"
            value={locationText}
            onChange={(event) => setLocationText(event.target.value)}
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
              hint="Te llamarán aquí."
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>

          {vehicles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {vehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => {
                    setMake(vehicle.make);
                    setModel(vehicle.model);
                    setPlate(formatPlate(vehicle.plate));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2"
                >
                  <CarIcon className="size-4" />
                  {vehicle.make} {vehicle.model}
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <TextField
              label="Marca"
              placeholder="Renault"
              value={make}
              onChange={(event) => setMake(event.target.value)}
            />
            <TextField
              label="Modelo"
              placeholder="Clio"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <TextField
              label="Matrícula"
              placeholder="1234 ABC"
              value={plate}
              onChange={(event) => setPlate(event.target.value.toUpperCase())}
            />
          </div>

          {shop.urgentNotes ? (
            <p className="rounded-card bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
              {shop.urgentNotes}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

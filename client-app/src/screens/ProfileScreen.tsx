import { useEffect, useState } from 'react';
import { appConfig } from '@/config';
import type { Vehicle } from '@/data/types';
import { cn } from '@/lib/cn';
import { formatPlate } from '@/lib/format';
import { CITIES } from '@/lib/geo';
import { VehicleSheet } from '@/components/profile/VehicleSheet';
import { AppShell, Section } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { CarIcon, PlusIcon, TrashIcon, UserIcon } from '@/components/ui/Icons';
import { EmptyState } from '@/components/ui/States';
import { useActivity } from '@/providers/ActivityProvider';
import { useCatalog } from '@/providers/CatalogProvider';
import { useRepository } from '@/providers/RepositoryProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

/** Perfil del conductor: sus datos y sus vehículos registrados. */
export function ProfileScreen() {
  const repository = useRepository();
  const {
    profile,
    vehicles,
    isSignedIn,
    loading,
    requestAuth,
    signOut,
    updateProfile,
    removeVehicle,
  } = useSession();
  const { items } = useActivity();
  const { favorites } = useCatalog();
  const { notify } = useToast();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [vehicleSheet, setVehicleSheet] = useState<{ open: boolean; vehicle: Vehicle | null }>({
    open: false,
    vehicle: null,
  });

  useEffect(() => {
    setFullName(profile?.fullName ?? '');
    setPhone(profile?.phone ?? '');
    setCity(profile?.city ?? '');
  }, [profile]);

  const dirty =
    profile !== null &&
    (fullName.trim() !== (profile.fullName ?? '') ||
      phone.trim() !== (profile.phone ?? '') ||
      city !== (profile.city ?? ''));

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateProfile({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        city: city || null,
      });
      notify('Datos actualizados', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No pudimos guardar los datos', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const deleteVehicle = async (vehicle: Vehicle) => {
    try {
      await removeVehicle(vehicle.id);
      notify('Vehículo eliminado', 'info');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No pudimos eliminarlo', 'error');
    }
  };

  if (!isSignedIn && !loading) {
    return (
      <AppShell header={<PageHeader title="Perfil" subtitle="Tus datos y tus vehículos" />}>
        <Section>
          <EmptyState
            icon={<UserIcon className="size-10" />}
            title="Crea tu cuenta de conductor"
            description="Guarda tus vehículos, sigue el estado de tus citas y pide asistencia urgente en dos toques."
            action={
              <Button size="sm" onClick={() => requestAuth('Crea tu cuenta de conductor')}>
                Entrar o crear cuenta
              </Button>
            }
          />
        </Section>

        <Section title="Sobre la app">
          <AppInfo mode={repository.mode} />
        </Section>
      </AppShell>
    );
  }

  return (
    <AppShell header={<PageHeader title="Perfil" subtitle={profile?.email ?? 'Tus datos'} />}>
      <Section className="pb-2">
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-[17px] font-bold text-accent">
            {(profile?.fullName || profile?.email || '?').trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">
              {profile?.fullName || 'Conductor'}
            </p>
            <p className="truncate text-[13px] text-muted">{profile?.email}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Citas" value={items.filter((item) => item.kind === 'booking').length} />
          <Stat label="Urgencias" value={items.filter((item) => item.kind === 'urgent').length} />
          <Stat label="Favoritos" value={favorites.length} />
        </div>
      </Section>

      <Section title="Mis datos">
        <div className="space-y-3 rounded-card border border-line bg-surface p-4">
          <TextField
            label="Nombre y apellidos"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <TextField
            label="Teléfono"
            type="tel"
            autoComplete="tel"
            hint="El taller lo usa para avisarte."
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <SelectField
            label="Ciudad habitual"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          >
            <option value="">Sin especificar</option>
            {CITIES.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </SelectField>

          <Button
            fullWidth
            disabled={!dirty}
            loading={savingProfile}
            onClick={() => void saveProfile()}
          >
            Guardar cambios
          </Button>
        </div>
      </Section>

      <Section
        title="Mis vehículos"
        action={
          <Button
            size="sm"
            variant="outline"
            icon={<PlusIcon className="size-4" />}
            onClick={() => setVehicleSheet({ open: true, vehicle: null })}
          >
            Añadir
          </Button>
        }
      >
        {vehicles.length === 0 ? (
          <EmptyState
            icon={<CarIcon className="size-10" />}
            title="Sin vehículos registrados"
            description="Añade tu coche y tus reservas se rellenarán solas."
          />
        ) : (
          <ul className="space-y-2">
            {vehicles.map((vehicle) => (
              <li
                key={vehicle.id}
                className="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                  <CarIcon className="size-5" />
                </span>
                <button
                  type="button"
                  onClick={() => setVehicleSheet({ open: true, vehicle })}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-ink">
                      {vehicle.make} {vehicle.model}
                    </span>
                    {vehicle.isDefault ? <Badge tone="accent">Habitual</Badge> : null}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted">
                    {formatPlate(vehicle.plate)}
                    {vehicle.year ? ` · ${vehicle.year}` : ''}
                    {vehicle.fuel ? ` · ${vehicle.fuel}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteVehicle(vehicle)}
                  aria-label={`Eliminar ${vehicle.make} ${vehicle.model}`}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-line-strong hover:bg-urgent-soft hover:text-urgent"
                >
                  <TrashIcon className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sobre la app">
        <AppInfo mode={repository.mode} />
        <Button
          variant="outline"
          fullWidth
          className="mt-3 text-urgent"
          onClick={() => {
            void signOut().then(() => notify('Sesión cerrada', 'info'));
          }}
        >
          Cerrar sesión
        </Button>
      </Section>

      <VehicleSheet
        open={vehicleSheet.open}
        vehicle={vehicleSheet.vehicle}
        onClose={() => setVehicleSheet({ open: false, vehicle: null })}
      />
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-line bg-surface py-3">
      <p className="text-[19px] leading-none font-bold text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-muted">{label}</p>
    </div>
  );
}

function AppInfo({ mode }: { mode: 'supabase' | 'demo' }) {
  return (
    <div className="space-y-2 rounded-card border border-line bg-surface px-4 py-3 text-[13px]">
      <Row label="Aplicación" value={appConfig.appName} />
      <Row
        label="Datos"
        value={mode === 'supabase' ? 'Supabase en tiempo real' : 'Catálogo demo local'}
        tone={mode === 'supabase' ? 'ok' : 'warn'}
      />
      <p className="pt-1 text-xs text-muted">
        Los talleres, horarios y precios los publica cada taller desde derteapp. Añade esta web a tu
        pantalla de inicio para usarla como una app.
      </p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span
        className={cn(
          'text-right font-medium',
          tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}

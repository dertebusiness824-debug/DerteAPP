import { useEffect, useState } from 'react';
import type { Vehicle } from '@/data/types';
import { formatPlate, normalizePlateForStorage } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { InlineError } from '@/components/ui/States';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

const FUELS = ['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico', 'GLP'] as const;

interface VehicleSheetProps {
  open: boolean;
  onClose: () => void;
  /** Vehículo a editar, o `null` para dar uno de alta. */
  vehicle: Vehicle | null;
}

/** Alta y edición de los vehículos del conductor. */
export function VehicleSheet({ open, onClose, vehicle }: VehicleSheetProps) {
  const { saveVehicle, vehicles } = useSession();
  const { notify } = useToast();

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [year, setYear] = useState('');
  const [fuel, setFuel] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMake(vehicle?.make ?? '');
    setModel(vehicle?.model ?? '');
    setPlate(vehicle ? formatPlate(vehicle.plate) : '');
    setYear(vehicle?.year ? String(vehicle.year) : '');
    setFuel(vehicle?.fuel ?? '');
    setIsDefault(vehicle?.isDefault ?? vehicles.length === 0);
  }, [open, vehicle, vehicles.length]);

  const canSubmit =
    make.trim().length > 1 && model.trim().length > 0 && normalizePlateForStorage(plate).length >= 4;

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const parsedYear = Number.parseInt(year, 10);
      await saveVehicle({
        ...(vehicle ? { id: vehicle.id } : {}),
        make: make.trim(),
        model: model.trim(),
        plate: normalizePlateForStorage(plate),
        year: Number.isFinite(parsedYear) && parsedYear > 1950 ? parsedYear : null,
        fuel: fuel || null,
        isDefault,
      });
      notify(vehicle ? 'Vehículo actualizado' : 'Vehículo guardado', 'success');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos guardar el vehículo.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={vehicle ? 'Editar vehículo' : 'Añadir vehículo'}
      subtitle="Se rellenará solo en tus próximas reservas."
      footer={
        <Button fullWidth loading={pending} disabled={!canSubmit} onClick={() => void submit()}>
          {vehicle ? 'Guardar cambios' : 'Añadir vehículo'}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <InlineError message={error} /> : null}

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Marca"
            required
            placeholder="Volkswagen"
            value={make}
            onChange={(event) => setMake(event.target.value)}
          />
          <TextField
            label="Modelo"
            required
            placeholder="Golf 1.6 TDI"
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
            label="Año"
            type="number"
            inputMode="numeric"
            placeholder="2018"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
          <SelectField
            label="Combustible"
            value={fuel}
            onChange={(event) => setFuel(event.target.value)}
          >
            <option value="">Sin especificar</option>
            {FUELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </div>

        <label className="flex items-start gap-2.5 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
            className="mt-0.5 size-4 rounded border-line-strong text-accent focus:ring-accent/30"
          />
          Usar como vehículo habitual
        </label>
      </div>
    </Sheet>
  );
}

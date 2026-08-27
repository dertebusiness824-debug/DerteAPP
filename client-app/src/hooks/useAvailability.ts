import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShopListing } from '@/data/types';
import {
  buildAvailabilityCalendar,
  firstDayWithAvailability,
  slotLoadMap,
  type DayAvailability,
} from '@/lib/slots';
import { addDaysToKey, todayKey, zonedTimeToUtc } from '@/lib/time';
import { useRepository } from '@/providers/RepositoryProvider';

/** Días de calendario que se ofrecen al conductor. */
export const CALENDAR_DAYS = 14;

interface AvailabilityState {
  calendar: DayAvailability[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Primer día con hueco libre, para preseleccionar el calendario. */
  firstOpenDay: DayAvailability | null;
}

/**
 * Disponibilidad real del taller: cruza el horario publicado con la ocupación
 * de su agenda (`marketplace_slot_load`, que cuenta las citas ya aceptadas en
 * el panel B2B). Se recalcula cada minuto para que la antelación mínima no
 * ofrezca huecos que acaban de caducar.
 */
export function useAvailability(
  shop: ShopListing | null,
  durationMinutes?: number,
): AvailabilityState {
  const repository = useRepository();
  const [load, setLoad] = useState<Map<string, number>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  const shopId = shop?.id ?? null;
  const timezone = shop?.timezone ?? 'Europe/Madrid';

  const refresh = useCallback(async () => {
    if (!shopId) return;
    const now = new Date();
    const first = todayKey(timezone, now);
    const from = zonedTimeToUtc(first, '00:00', timezone).toISOString();
    const to = zonedTimeToUtc(addDaysToKey(first, CALENDAR_DAYS), '00:00', timezone).toISOString();

    try {
      setLoad(slotLoadMap(await repository.getSlotLoad(shopId, from, to)));
      setError(null);
    } catch {
      // Sin ocupación no bloqueamos la reserva: el RPC vuelve a validar el
      // aforo en el servidor antes de escribir la cita.
      setLoad(new Map());
      setError('No pudimos comprobar los huecos ocupados. Puede que alguna hora ya no esté libre.');
    }
  }, [repository, shopId, timezone]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const run = async () => {
      await refresh();
      if (active) setLoading(false);
    };

    void run();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const calendar = useMemo(() => {
    if (!shop) return [];
    return buildAvailabilityCalendar(shop, load, {
      days: CALENDAR_DAYS,
      now: new Date(tick),
      durationMinutes,
    });
  }, [durationMinutes, load, shop, tick]);

  return {
    calendar,
    loading,
    error,
    refresh,
    firstOpenDay: firstDayWithAvailability(calendar),
  };
}

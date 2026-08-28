import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BookingDraft,
  BookingResult,
  CustomerActivity,
  UrgentRequestDraft,
  UrgentRequestResult,
} from '@/data/types';
import { toMarketplaceError } from '@/data/errors';
import { sortActivity } from '@/lib/status';
import { useRepository } from './RepositoryProvider';
import { useSession } from './SessionProvider';

interface ActivityContextValue {
  items: CustomerActivity[];
  upcoming: CustomerActivity[];
  history: CustomerActivity[];
  loading: boolean;
  refresh: () => Promise<void>;
  createBooking: (draft: BookingDraft) => Promise<BookingResult>;
  createUrgentRequest: (draft: UrgentRequestDraft) => Promise<UrgentRequestResult>;
  cancelBooking: (bookingId: string) => Promise<void>;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const repository = useRepository();
  const { isSignedIn } = useSession();
  const [items, setItems] = useState<CustomerActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setItems([]);
      return;
    }
    try {
      setItems(await repository.listActivity());
    } catch {
      setItems([]);
    }
  }, [isSignedIn, repository]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      await refresh();
      if (active) setLoading(false);
    };

    void load();

    // El taller acepta, empieza o cierra la cita en su panel: el cambio llega
    // por Realtime y esta lista se vuelve a pedir.
    const unsubscribe = isSignedIn
      ? repository.subscribeToActivity(() => {
          void refresh();
        })
      : () => {};

    return () => {
      active = false;
      unsubscribe();
    };
  }, [isSignedIn, refresh, repository]);

  const createBooking = useCallback(
    async (draft: BookingDraft) => {
      try {
        const result = await repository.createBooking(draft);
        await refresh();
        return result;
      } catch (error) {
        throw toMarketplaceError(error, 'No pudimos crear la reserva.');
      }
    },
    [refresh, repository],
  );

  const createUrgentRequest = useCallback(
    async (draft: UrgentRequestDraft) => {
      try {
        const result = await repository.createUrgentRequest(draft);
        await refresh();
        return result;
      } catch (error) {
        throw toMarketplaceError(error, 'No pudimos enviar la solicitud urgente.');
      }
    },
    [refresh, repository],
  );

  const cancelBooking = useCallback(
    async (bookingId: string) => {
      try {
        await repository.cancelBooking(bookingId);
        await refresh();
      } catch (error) {
        throw toMarketplaceError(error, 'No pudimos cancelar la cita.');
      }
    },
    [refresh, repository],
  );

  const value = useMemo<ActivityContextValue>(() => {
    const { upcoming, history } = sortActivity(items);
    return {
      items,
      upcoming,
      history,
      loading,
      refresh,
      createBooking,
      createUrgentRequest,
      cancelBooking,
    };
  }, [cancelBooking, createBooking, createUrgentRequest, items, loading, refresh]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const context = useContext(ActivityContext);
  if (!context) throw new Error('useActivity debe usarse dentro de <ActivityProvider>');
  return context;
}

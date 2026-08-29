import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthCredentials, CustomerProfile, Vehicle } from '@/data/types';
import { toMarketplaceError } from '@/data/errors';
import { useRepository } from './RepositoryProvider';

interface SessionContextValue {
  profile: CustomerProfile | null;
  vehicles: Vehicle[];
  loading: boolean;
  isSignedIn: boolean;
  /** Motivo por el que se ha abierto el panel de acceso (o `null` si está cerrado). */
  authPrompt: string | null;
  requestAuth: (reason?: string) => void;
  closeAuth: () => void;
  signIn: (credentials: AuthCredentials) => Promise<void>;
  signUp: (credentials: AuthCredentials) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Omit<CustomerProfile, 'id'>>) => Promise<void>;
  saveVehicle: (vehicle: Omit<Vehicle, 'id'> & { id?: string }) => Promise<void>;
  removeVehicle: (vehicleId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const repository = useRepository();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [authPrompt, setAuthPrompt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextProfile = await repository.getProfile();
    setProfile(nextProfile);
    setVehicles(nextProfile ? await repository.listVehicles() : []);
  }, [repository]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        await refresh();
      } catch {
        // Keep the last good profile. A flaky vehicle / catalog fetch must
        // not look like a sign-out and dump the driver on Home.
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const unsubscribe = repository.onAuthStateChange(() => {
      void load();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh, repository]);

  const signIn = useCallback(
    async (credentials: AuthCredentials) => {
      try {
        await repository.signIn(credentials);
        await refresh();
        setAuthPrompt(null);
      } catch (error) {
        throw toMarketplaceError(error, 'No pudimos iniciar sesión.');
      }
    },
    [refresh, repository],
  );

  const signUp = useCallback(
    async (credentials: AuthCredentials) => {
      try {
        const result = await repository.signUp(credentials);
        if (!result.needsEmailConfirmation) {
          await refresh();
          setAuthPrompt(null);
        }
        return result;
      } catch (error) {
        throw toMarketplaceError(error, 'No pudimos crear la cuenta.');
      }
    },
    [refresh, repository],
  );

  const signOut = useCallback(async () => {
    await repository.signOut();
    setProfile(null);
    setVehicles([]);
  }, [repository]);

  const updateProfile = useCallback(
    async (patch: Partial<Omit<CustomerProfile, 'id'>>) => {
      const updated = await repository.updateProfile(patch);
      setProfile(updated);
    },
    [repository],
  );

  const saveVehicle = useCallback(
    async (vehicle: Omit<Vehicle, 'id'> & { id?: string }) => {
      await repository.saveVehicle(vehicle);
      setVehicles(await repository.listVehicles());
    },
    [repository],
  );

  const removeVehicle = useCallback(
    async (vehicleId: string) => {
      await repository.removeVehicle(vehicleId);
      setVehicles(await repository.listVehicles());
    },
    [repository],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      profile,
      vehicles,
      loading,
      isSignedIn: profile !== null,
      authPrompt,
      requestAuth: (reason) => setAuthPrompt(reason ?? 'Entra en tu cuenta para continuar'),
      closeAuth: () => setAuthPrompt(null),
      signIn,
      signUp,
      signOut,
      updateProfile,
      saveVehicle,
      removeVehicle,
      refresh,
    }),
    [
      authPrompt,
      loading,
      profile,
      refresh,
      removeVehicle,
      saveVehicle,
      signIn,
      signOut,
      signUp,
      updateProfile,
      vehicles,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return context;
}

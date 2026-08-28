import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRepository } from '@/data';
import type { MarketplaceRepository } from '@/data/types';
import { SplashScreen } from '@/components/layout/SplashScreen';

interface RepositoryContextValue {
  repository: MarketplaceRepository;
  /** Aviso de arranque (por ejemplo, que se ha caído a modo demo). */
  notice: string | null;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; value: RepositoryContextValue }
  | { status: 'error'; message: string };

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    createRepository()
      .then(({ repository, notice }) => {
        if (!cancelled) setBoot({ status: 'ready', value: { repository, notice } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'No se pudo iniciar la aplicación.';
        setBoot({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.status === 'loading') return <SplashScreen />;
  if (boot.status === 'error') return <SplashScreen error={boot.message} />;

  return <RepositoryContext.Provider value={boot.value}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): MarketplaceRepository {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error('useRepository debe usarse dentro de <RepositoryProvider>');
  return context.repository;
}

export function useBootNotice(): string | null {
  return useContext(RepositoryContext)?.notice ?? null;
}

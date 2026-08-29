import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShopListing } from '@/data/types';
import { toMarketplaceError } from '@/data/errors';
import { useRepository } from './RepositoryProvider';
import { useSession } from './SessionProvider';

interface CatalogContextValue {
  shops: ShopListing[];
  favorites: string[];
  loading: boolean;
  error: string | null;
  /** Marca de tiempo de la última sincronización con el catálogo. */
  syncedAt: number | null;
  refresh: () => Promise<void>;
  toggleFavorite: (shopId: string) => Promise<boolean>;
  isFavorite: (shopId: string) => boolean;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const repository = useRepository();
  const { isSignedIn, requestAuth } = useSession();
  const [shops, setShops] = useState<ShopListing[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      // El catálogo se descarga completo (decenas de talleres) y se filtra en
      // el cliente: así el buscador y el mapa responden sin más peticiones.
      const list = await repository.listShops();
      setShops(list);
      setError(null);
      setSyncedAt(Date.now());
    } catch (caught) {
      setError(toMarketplaceError(caught, 'No pudimos cargar los talleres.').message);
    }
  }, [repository]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      await refresh();
      if (active) setLoading(false);
    };

    void load();
    const unsubscribe = repository.subscribeToCatalog(() => {
      void refresh();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh, repository]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!isSignedIn) {
        setFavorites([]);
        return;
      }
      try {
        const list = await repository.listFavorites();
        if (active) setFavorites(list);
      } catch {
        // Keep the last known list — a 401 here is not a sign-out.
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [isSignedIn, repository]);

  const toggleFavorite = useCallback(
    async (shopId: string) => {
      if (!isSignedIn) {
        requestAuth('Entra en tu cuenta para guardar talleres favoritos');
        return false;
      }

      const next = !favorites.includes(shopId);
      setFavorites((current) =>
        next ? [...current, shopId] : current.filter((id) => id !== shopId),
      );

      try {
        await repository.setFavorite(shopId, next);
        return next;
      } catch (caught) {
        setFavorites((current) =>
          next ? current.filter((id) => id !== shopId) : [...current, shopId],
        );
        throw toMarketplaceError(caught, 'No pudimos guardar el favorito.');
      }
    },
    [favorites, isSignedIn, repository, requestAuth],
  );

  const value = useMemo<CatalogContextValue>(
    () => ({
      shops,
      favorites,
      loading,
      error,
      syncedAt,
      refresh,
      toggleFavorite,
      isFavorite: (shopId: string) => favorites.includes(shopId),
    }),
    [error, favorites, loading, refresh, shops, syncedAt, toggleFavorite],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const context = useContext(CatalogContext);
  if (!context) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>');
  return context;
}

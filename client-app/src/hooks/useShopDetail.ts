import { useCallback, useEffect, useState } from 'react';
import type { ShopDetail } from '@/data/types';
import { toMarketplaceError } from '@/data/errors';
import { useRepository } from '@/providers/RepositoryProvider';

interface ShopDetailState {
  shop: ShopDetail | null;
  loading: boolean;
  /** `true` cuando el taller no existe o ya no está publicado. */
  notFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Ficha completa del taller. Se vuelve a pedir cuando llega un cambio del
 * catálogo por Realtime (el taller edita precios, horario o urgencias 24h).
 */
export function useShopDetail(shopId: string | undefined): ShopDetailState {
  const repository = useRepository();
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!shopId) {
      setNotFound(true);
      return;
    }
    try {
      const detail = await repository.getShop(shopId);
      setShop(detail);
      setNotFound(detail === null);
      setError(null);
    } catch (caught) {
      setError(toMarketplaceError(caught, 'No pudimos cargar este taller.').message);
    }
  }, [repository, shopId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);

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

  return { shop, loading, notFound, error, refresh };
}

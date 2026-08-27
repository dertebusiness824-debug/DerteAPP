import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { decorateShops } from '@/lib/search';
import { AppShell, Section } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { ShopCard } from '@/components/shops/ShopCard';
import { Button } from '@/components/ui/Button';
import { HeartIcon } from '@/components/ui/Icons';
import { EmptyState, InlineError, ShopCardSkeleton } from '@/components/ui/States';
import { useCatalog } from '@/providers/CatalogProvider';
import { useLocation } from '@/providers/LocationProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

/** Talleres guardados por el conductor. */
export function FavoritesScreen() {
  const navigate = useNavigate();
  const { shops, favorites, loading, error, refresh, isFavorite, toggleFavorite } = useCatalog();
  const { isSignedIn, requestAuth, loading: sessionLoading } = useSession();
  const { origin } = useLocation();
  const { notify } = useToast();

  const entries = useMemo(() => {
    const saved = shops.filter((shop) => favorites.includes(shop.id));
    return decorateShops(saved, origin);
  }, [favorites, origin, shops]);

  const handleToggle = async (shopId: string) => {
    try {
      const next = await toggleFavorite(shopId);
      notify(next ? 'Taller guardado' : 'Taller quitado de favoritos', 'info');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No se pudo actualizar', 'error');
    }
  };

  return (
    <AppShell
      header={
        <PageHeader
          title="Favoritos"
          subtitle={
            isSignedIn
              ? `${entries.length} taller${entries.length === 1 ? '' : 'es'} guardado${
                  entries.length === 1 ? '' : 's'
                }`
              : 'Guarda tus talleres de confianza'
          }
        />
      }
    >
      <Section>
        {error ? <InlineError message={error} onRetry={() => void refresh()} /> : null}

        {!isSignedIn && !sessionLoading ? (
          <EmptyState
            icon={<HeartIcon className="size-10" />}
            title="Entra para guardar talleres"
            description="Tus favoritos te acompañan en cualquier dispositivo."
            action={
              <Button size="sm" onClick={() => requestAuth('Entra para guardar tus favoritos')}>
                Entrar o crear cuenta
              </Button>
            }
          />
        ) : loading || sessionLoading ? (
          <div className="space-y-3">
            <ShopCardSkeleton />
            <ShopCardSkeleton />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<HeartIcon className="size-10" />}
            title="Todavía no tienes favoritos"
            description="Toca el corazón de un taller para tenerlo siempre a mano."
            action={
              <Button size="sm" onClick={() => navigate('/')}>
                Explorar talleres
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.shop.id}>
                <ShopCard
                  entry={entry}
                  isFavorite={isFavorite(entry.shop.id)}
                  onToggleFavorite={(shopId) => void handleToggle(shopId)}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </AppShell>
  );
}

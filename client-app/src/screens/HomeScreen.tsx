import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appConfig } from '@/config';
import { cn } from '@/lib/cn';
import { pluralize } from '@/lib/format';
import {
  DEFAULT_FILTERS,
  decorateShops,
  filterShops,
  findServiceCategory,
  type ShopFilters,
} from '@/lib/search';
import { AppShell, Section } from '@/components/layout/AppShell';
import { ShopMiniMap } from '@/components/map/ShopMiniMap';
import { FilterChips, SortToggle } from '@/components/search/FilterChips';
import { LocationPicker } from '@/components/search/LocationPicker';
import { SearchBar } from '@/components/search/SearchBar';
import { ShopCard } from '@/components/shops/ShopCard';
import { Button } from '@/components/ui/Button';
import { ListIcon, LogoMark, MapIcon, SearchIcon } from '@/components/ui/Icons';
import { EmptyState, InlineError, ShopCardSkeleton } from '@/components/ui/States';
import { useCatalog } from '@/providers/CatalogProvider';
import { useLocation } from '@/providers/LocationProvider';
import { useRepository } from '@/providers/RepositoryProvider';
import { useBootNotice } from '@/providers/RepositoryProvider';
import { useToast } from '@/providers/ToastProvider';

export function HomeScreen() {
  const navigate = useNavigate();
  const repository = useRepository();
  const bootNotice = useBootNotice();
  const { notify } = useToast();
  const { shops, loading, error, refresh, isFavorite, toggleFavorite } = useCatalog();
  const { city, neighborhood, origin, usingDeviceLocation } = useLocation();

  const [filters, setFilters] = useState<ShopFilters>(DEFAULT_FILTERS);
  const [showMap, setShowMap] = useState(true);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  const decorated = useMemo(() => decorateShops(shops, origin), [origin, shops]);

  const results = useMemo(() => {
    const scoped = filterShops(decorated, { ...filters, city });
    if (!neighborhood) return scoped;

    // El barrio afina el listado, pero nunca deja la pantalla vacía.
    const inNeighborhood = scoped.filter((entry) => entry.shop.neighborhood === neighborhood);
    return inNeighborhood.length > 0 ? inNeighborhood : scoped;
  }, [city, decorated, filters, neighborhood]);

  const activeCategory = findServiceCategory(filters.serviceSlug);
  const urgentCount = results.filter((entry) => entry.shop.acceptsUrgent24h).length;

  const patchFilters = (patch: Partial<ShopFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  const handleToggleFavorite = async (shopId: string) => {
    try {
      const next = await toggleFavorite(shopId);
      if (next) notify('Taller guardado en favoritos', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No se pudo guardar', 'error');
    }
  };

  return (
    <AppShell
      header={
        <header className="sticky top-0 z-40 space-y-3 border-b border-line bg-surface/95 px-4 pt-3 pb-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white">
                <LogoMark className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] leading-tight font-semibold text-ink">
                  {appConfig.appName}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {repository.mode === 'demo'
                    ? 'Catálogo de demostración'
                    : 'Talleres verificados en tiempo real'}
                </p>
              </div>
            </div>
            <LocationPicker />
          </div>

          <SearchBar
            value={filters.query}
            onChange={(query) => patchFilters({ query })}
            entries={decorated}
            onPickService={(slug) => patchFilters({ serviceSlug: slug })}
          />

          <FilterChips filters={filters} onChange={patchFilters} />
        </header>
      }
    >
      {bootNotice ? (
        <div className="mx-4 mt-4 rounded-card border border-warn/25 bg-warn-soft px-4 py-3 text-[13px] text-warn">
          {bootNotice}
        </div>
      ) : null}

      <Section className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink">
              {activeCategory ? activeCategory.label : 'Talleres cerca de ti'}
            </h2>
            <p className="truncate text-[13px] text-muted">
              {loading
                ? 'Cargando talleres…'
                : `${pluralize(results.length, 'taller', 'talleres')} en ${
                    neighborhood ?? city
                  }${urgentCount > 0 ? ` · ${urgentCount} con urgencias 24h` : ''}`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowMap((current) => !current)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2"
          >
            {showMap ? <ListIcon className="size-4" /> : <MapIcon className="size-4" />}
            {showMap ? 'Ver solo lista' : 'Ver mapa'}
          </button>
        </div>

        {showMap && !loading && results.length > 0 ? (
          <ShopMiniMap
            className="mt-3"
            entries={results}
            origin={origin}
            selectedShopId={selectedShopId}
            onSelect={setSelectedShopId}
            onOpen={(shopId) => navigate(`/taller/${shopId}`)}
            usingDeviceLocation={usingDeviceLocation}
          />
        ) : null}
      </Section>

      <Section
        className="pt-1"
        action={<SortToggle value={filters.sort} onChange={(sort) => patchFilters({ sort })} />}
      >
        {error ? <InlineError message={error} onRetry={() => void refresh()} /> : null}

        {loading ? (
          <div className="space-y-3">
            <ShopCardSkeleton />
            <ShopCardSkeleton />
            <ShopCardSkeleton />
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-10" />}
            title="No hay talleres con esos filtros"
            description="Prueba a quitar algún filtro o a buscar en otra ciudad."
            action={
              <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Quitar filtros
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {results.map((entry) => (
              <li key={entry.shop.id}>
                <ShopCard
                  entry={entry}
                  isFavorite={isFavorite(entry.shop.id)}
                  onToggleFavorite={(shopId) => void handleToggleFavorite(shopId)}
                  highlighted={selectedShopId === entry.shop.id}
                  onHighlight={setSelectedShopId}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p
        className={cn(
          'px-4 pt-1 pb-6 text-center text-[11px] text-muted',
          results.length === 0 && 'hidden',
        )}
      >
        Los talleres se sincronizan automáticamente con la plataforma derteapp.
      </p>
    </AppShell>
  );
}

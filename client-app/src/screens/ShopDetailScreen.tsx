import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import {
  distanceKm as computeDistanceKm,
  estimateDriveMinutes,
  formatDistance,
  isValidCoordinates,
} from '@/lib/geo';
import { getOpenState } from '@/lib/hours';
import { AppShell, Section } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { UrgentRequestSheet } from '@/components/booking/UrgentRequestSheet';
import { ReviewSection } from '@/components/shops/ReviewSection';
import { PromotionList } from '@/components/shops/PromotionList';
import { ServiceList } from '@/components/shops/ServiceList';
import { ShopHoursList } from '@/components/shops/ShopHoursList';
import { OpenBadge, UrgentBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  BoltIcon,
  CalendarIcon,
  HeartIcon,
  NavigationIcon,
  PhoneIcon,
  PinIcon,
  ShieldIcon,
} from '@/components/ui/Icons';
import { Stars } from '@/components/ui/Stars';
import { EmptyState, InlineError, Skeleton } from '@/components/ui/States';
import { useShopDetail } from '@/hooks/useShopDetail';
import { useCatalog } from '@/providers/CatalogProvider';
import { useLocation } from '@/providers/LocationProvider';
import { useToast } from '@/providers/ToastProvider';

/**
 * Ficha del taller: contacto, horario, tarifa, opiniones y la doble acción
 * destacada (cita normal / asistencia urgente).
 */
export function ShopDetailScreen() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const { shop, loading, notFound, error, refresh } = useShopDetail(shopId);
  const { isFavorite, toggleFavorite } = useCatalog();
  const { origin } = useLocation();
  const { notify } = useToast();

  const [bookingOpen, setBookingOpen] = useState(false);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [initialServiceId, setInitialServiceId] = useState<string | null>(null);

  const openState = useMemo(
    () => (shop ? getOpenState(shop.hours, shop.timezone) : null),
    [shop],
  );

  const distance = useMemo(() => {
    if (!shop || !origin) return null;
    const coords = { latitude: shop.latitude ?? NaN, longitude: shop.longitude ?? NaN };
    if (!isValidCoordinates(coords)) return null;
    return computeDistanceKm(origin, coords);
  }, [origin, shop]);

  if (loading) {
    return (
      <AppShell hideNav header={<PageHeader title="Cargando taller…" back />}>
        <Section className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </Section>
      </AppShell>
    );
  }

  if (notFound || !shop) {
    return (
      <AppShell hideNav header={<PageHeader title="Taller no disponible" back />}>
        <Section>
          {error ? <InlineError message={error} onRetry={() => void refresh()} /> : null}
          <EmptyState
            icon={<PinIcon className="size-10" />}
            title="Este taller ya no está publicado"
            description="Puede que haya cerrado su ficha en derteapp. Prueba con otro taller cercano."
            action={
              <Button variant="outline" size="sm" onClick={() => navigate('/')}>
                Ver talleres cercanos
              </Button>
            }
          />
        </Section>
      </AppShell>
    );
  }

  const favorite = isFavorite(shop.id);
  const mapsQuery = encodeURIComponent(
    isValidCoordinates({ latitude: shop.latitude ?? NaN, longitude: shop.longitude ?? NaN })
      ? `${shop.latitude},${shop.longitude}`
      : [shop.name, shop.address, shop.city].filter(Boolean).join(', '),
  );

  const handleBook = (serviceId: string | null) => {
    setInitialServiceId(serviceId);
    setBookingOpen(true);
  };

  return (
    <AppShell
      hideNav
      header={
        <PageHeader
          title={shop.name}
          subtitle={[shop.neighborhood, shop.city].filter(Boolean).join(' · ')}
          back
          action={
            <button
              type="button"
              onClick={() => {
                void toggleFavorite(shop.id)
                  .then((next) => {
                    if (next) notify('Taller guardado en favoritos', 'success');
                  })
                  .catch((caught: unknown) => {
                    notify(caught instanceof Error ? caught.message : 'No se pudo guardar', 'error');
                  });
              }}
              aria-label={favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
              aria-pressed={favorite}
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
                favorite ? 'text-urgent' : 'text-line-strong hover:text-muted',
              )}
            >
              <HeartIcon filled={favorite} className="size-5" />
            </button>
          }
        />
      }
      className="pb-36"
    >
      <div
        className={cn(
          'relative overflow-hidden',
          shop.acceptsUrgent24h
            ? 'bg-gradient-to-br from-accent-soft via-surface to-urgent-soft'
            : 'bg-gradient-to-br from-accent-soft via-surface to-brand-soft',
        )}
      >
        {shop.coverImageUrl ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <img
              src={shop.coverImageUrl}
              alt={`Portada de ${shop.name}`}
              className="size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/55 via-ink/10 to-transparent" />
          </div>
        ) : null}
        <div className="relative px-4 pt-5 pb-4">
        <div className="flex items-start gap-3">
          {shop.coverImageUrl ? (
            <img
              src={shop.coverImageUrl}
              alt=""
              width={56}
              height={56}
              className="size-14 shrink-0 rounded-2xl object-cover shadow-card ring-2 ring-surface"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-14 shrink-0 place-items-center rounded-2xl bg-surface text-[17px] font-bold text-accent shadow-card"
            >
              {shop.name
                .split(' ')
                .filter((word) => word.length > 2)
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase())
                .join('')}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {/* El nombre ya va como h1 en la cabecera pegajosa. */}
            <h2 className="text-[19px] leading-tight font-bold text-ink">{shop.name}</h2>
            <div className="mt-1.5">
              <Stars rating={shop.ratingAvg} count={shop.ratingCount} size="md" />
            </div>
            {shop.headline ? (
              <p className="mt-2 text-[13px] text-ink-2">{shop.headline}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {openState ? <OpenBadge openNow={openState.openNow} label={openState.label} /> : null}
          {distance !== null ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink-2">
              {formatDistance(distance)}
              <span className="font-normal text-muted">· {estimateDriveMinutes(distance)} min</span>
            </span>
          ) : null}
          {shop.acceptsUrgent24h ? <UrgentBadge /> : null}
        </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-line bg-surface px-4 py-3">
        <QuickAction
          href={shop.phone ? `tel:${shop.phone.replace(/\s+/g, '')}` : undefined}
          icon={<PhoneIcon className="size-5" />}
          label="Llamar"
        />
        <QuickAction
          href={
            shop.whatsappPhone
              ? `https://wa.me/${shop.whatsappPhone.replace(/[^0-9]/g, '')}`
              : undefined
          }
          icon={<ShieldIcon className="size-5" />}
          label="WhatsApp"
          external
        />
        <QuickAction
          href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
          icon={<NavigationIcon className="size-5" />}
          label="Cómo llegar"
          external
        />
      </div>

      {shop.description ? (
        <Section title="Sobre el taller">
          <p className="text-[14px] leading-relaxed text-ink-2">{shop.description}</p>
        </Section>
      ) : null}

      {shop.promotions.length > 0 ? (
        <Section title="Ofertas y promociones">
          <PromotionList promotions={shop.promotions} />
        </Section>
      ) : null}

      <Section title="Contacto y dirección">
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface text-[14px]">
          {shop.address ? (
            <InfoRow icon={<PinIcon className="size-4" />} label="Dirección">
              {[shop.address, shop.neighborhood, shop.city].filter(Boolean).join(', ')}
            </InfoRow>
          ) : null}
          {shop.phone ? (
            <InfoRow icon={<PhoneIcon className="size-4" />} label="Teléfono">
              <a href={`tel:${shop.phone.replace(/\s+/g, '')}`} className="text-accent">
                {shop.phone}
              </a>
            </InfoRow>
          ) : null}
          {shop.email ? (
            <InfoRow icon={<ShieldIcon className="size-4" />} label="Email">
              <a href={`mailto:${shop.email}`} className="text-accent">
                {shop.email}
              </a>
            </InfoRow>
          ) : null}
          {shop.websiteUrl ? (
            <InfoRow icon={<NavigationIcon className="size-4" />} label="Web">
              <a
                href={shop.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent"
              >
                {shop.websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            </InfoRow>
          ) : null}
        </ul>
      </Section>

      <Section title="Horario">
        <ShopHoursList hours={shop.hours} timezone={shop.timezone} />
      </Section>

      <Section title="Servicios y precios orientativos">
        <ServiceList
          services={shop.services}
          slotMinutes={shop.slotMinutes}
          onBook={(serviceId) => handleBook(serviceId)}
        />
      </Section>

      <Section title="Opiniones de clientes">
        <ReviewSection
          shopId={shop.id}
          reviews={shop.reviews}
          ratingAvg={shop.ratingAvg}
          ratingCount={shop.ratingCount}
          onSubmitted={() => void refresh()}
        />
      </Section>

      {shop.acceptsUrgent24h && shop.urgentNotes ? (
        <Section title="Urgencias 24h">
          <p className="rounded-card border border-urgent/20 bg-urgent-soft px-4 py-3 text-[13px] text-urgent-strong">
            {shop.urgentNotes}
          </p>
        </Section>
      ) : null}

      {/* Doble acción destacada, fija sobre el contenido. */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur">
        <div
          className={cn(
            'mx-auto grid max-w-page gap-2 px-4 py-3',
            shop.acceptsUrgent24h ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
          <Button
            size="lg"
            icon={<CalendarIcon className="size-5" />}
            onClick={() => handleBook(null)}
          >
            Reservar cita
          </Button>
          {shop.acceptsUrgent24h ? (
            <Button
              size="lg"
              variant="urgent"
              icon={<BoltIcon className="size-5" />}
              onClick={() => setUrgentOpen(true)}
            >
              Asistencia urgente
            </Button>
          ) : null}
        </div>
      </div>

      <BookingSheet
        shop={shop}
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        initialServiceId={initialServiceId}
      />
      <UrgentRequestSheet shop={shop} open={urgentOpen} onClose={() => setUrgentOpen(false)} />
    </AppShell>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-3.5 py-3">
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
        <p className="mt-0.5 break-words text-ink">{children}</p>
      </div>
    </li>
  );
}

function QuickAction({
  href,
  icon,
  label,
  external = false,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  external?: boolean;
}) {
  const className =
    'flex flex-col items-center gap-1 rounded-xl border border-line py-2.5 text-[12px] font-semibold text-ink-2';

  if (!href) {
    return (
      <span className={cn(className, 'opacity-45')} aria-disabled="true">
        <span className="text-line-strong">{icon}</span>
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      className={cn(className, 'transition-colors hover:bg-surface-2')}
    >
      <span className="text-accent">{icon}</span>
      {label}
    </a>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CustomerActivity } from '@/data/types';
import { cn } from '@/lib/cn';
import { ActivityCard } from '@/components/activity/ActivityCard';
import { AppShell, Section } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { CalendarIcon, SearchIcon } from '@/components/ui/Icons';
import { EmptyState, ShopCardSkeleton } from '@/components/ui/States';
import { useActivity } from '@/providers/ActivityProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

type Tab = 'upcoming' | 'history';

/**
 * Historial de citas y avisos urgentes con su estado. La lista se actualiza en
 * cuanto el taller cambia el estado en derteapp (Supabase Realtime).
 */
export function AppointmentsScreen() {
  const navigate = useNavigate();
  const { upcoming, history, loading, cancelBooking } = useActivity();
  const { isSignedIn, requestAuth, loading: sessionLoading } = useSession();
  const { notify } = useToast();

  const [tab, setTab] = useState<Tab>('upcoming');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (activity: CustomerActivity) => {
    setCancellingId(activity.id);
    try {
      await cancelBooking(activity.id);
      notify('Cita cancelada', 'info');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No pudimos cancelar la cita', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const items = tab === 'upcoming' ? upcoming : history;

  return (
    <AppShell
      header={
        <PageHeader title="Mis citas" subtitle="Reservas y avisos urgentes">
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {(
              [
                { id: 'upcoming' as Tab, label: `Activas${upcoming.length ? ` (${upcoming.length})` : ''}` },
                { id: 'history' as Tab, label: 'Historial' },
              ]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTab(option.id)}
                aria-pressed={tab === option.id}
                className={cn(
                  'rounded-lg py-2 text-[13px] font-semibold transition-colors',
                  tab === option.id ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </PageHeader>
      }
    >
      <Section>
        {!isSignedIn && !sessionLoading ? (
          <EmptyState
            icon={<CalendarIcon className="size-10" />}
            title="Entra para ver tus citas"
            description="Tus reservas y avisos urgentes quedan guardados en tu cuenta."
            action={
              <Button size="sm" onClick={() => requestAuth('Entra para ver tus citas')}>
                Entrar o crear cuenta
              </Button>
            }
          />
        ) : loading || sessionLoading ? (
          <div className="space-y-3">
            <ShopCardSkeleton />
            <ShopCardSkeleton />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={tab === 'upcoming' ? <CalendarIcon className="size-10" /> : <SearchIcon className="size-10" />}
            title={tab === 'upcoming' ? 'No tienes citas activas' : 'Tu historial está vacío'}
            description={
              tab === 'upcoming'
                ? 'Busca un taller cerca de ti y reserva en menos de un minuto.'
                : 'Aquí verás las citas completadas y canceladas.'
            }
            action={
              tab === 'upcoming' ? (
                <Button size="sm" onClick={() => navigate('/')}>
                  Buscar taller
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {items.map((activity) => (
              <li key={`${activity.kind}-${activity.id}`}>
                <ActivityCard
                  activity={activity}
                  onCancel={tab === 'upcoming' ? (entry) => void handleCancel(entry) : undefined}
                  cancelling={cancellingId === activity.id}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </AppShell>
  );
}

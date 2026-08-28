import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerActivity } from '@/data/types';
import { cn } from '@/lib/cn';
import { formatDateTime, formatPlate, formatRelative } from '@/lib/format';
import { activityStatusView, isCancellable, type StatusTone } from '@/lib/status';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BoltIcon, CalendarIcon, CarIcon, PhoneIcon, PinIcon } from '@/components/ui/Icons';

const TONE_TO_BADGE: Record<StatusTone, BadgeTone> = {
  ok: 'ok',
  warn: 'warn',
  accent: 'accent',
  muted: 'muted',
  urgent: 'urgent',
};

interface ActivityCardProps {
  activity: CustomerActivity;
  onCancel?: (activity: CustomerActivity) => void;
  cancelling?: boolean;
}

/**
 * Tarjeta de «Mis citas»: sirve tanto para reservas normales como para avisos
 * urgentes, y refleja el estado que el taller marca en su panel.
 */
export function ActivityCard({ activity, onCancel, cancelling = false }: ActivityCardProps) {
  const status = activityStatusView(activity);
  const urgent = activity.kind === 'urgent';
  const vehicle = [activity.vehicleMake, activity.vehicleModel].filter(Boolean).join(' ');

  return (
    <article
      className={cn(
        'rounded-card border bg-surface p-4',
        urgent ? 'border-urgent/25' : 'border-line',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-xl',
            urgent ? 'bg-urgent-soft text-urgent' : 'bg-accent-soft text-accent',
          )}
        >
          {urgent ? <BoltIcon className="size-5" /> : <CalendarIcon className="size-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={`/taller/${activity.shopId}`}
              className="min-w-0 truncate text-[15px] leading-tight font-semibold text-ink"
            >
              {activity.shopName}
            </Link>
            <Badge tone={TONE_TO_BADGE[status.tone]}>{status.label}</Badge>
          </div>

          <p className="mt-1 text-[13px] font-medium text-ink-2">
            {activity.kind === 'booking'
              ? formatDateTime(activity.scheduledAt, activity.timezone)
              : `Aviso urgente · ${formatRelative(activity.createdAt)}`}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">{status.description}</p>

          <dl className="mt-2.5 space-y-1 text-[13px]">
            {activity.kind === 'booking' && activity.serviceName ? (
              <Detail icon={<CalendarIcon className="size-4" />}>{activity.serviceName}</Detail>
            ) : null}
            {activity.kind === 'urgent' && activity.reason ? (
              <Detail icon={<BoltIcon className="size-4" />}>{activity.reason}</Detail>
            ) : null}
            {activity.kind === 'urgent' && activity.locationText ? (
              <Detail icon={<PinIcon className="size-4" />}>{activity.locationText}</Detail>
            ) : null}
            {vehicle ? (
              <Detail icon={<CarIcon className="size-4" />}>
                {vehicle}
                {activity.vehiclePlate ? ` · ${formatPlate(activity.vehiclePlate)}` : ''}
              </Detail>
            ) : null}
          </dl>

          {activity.kind === 'booking' && activity.reference ? (
            <p className="mt-2 font-mono text-[11px] text-muted">Ref. {activity.reference}</p>
          ) : null}

          {activity.kind === 'urgent' && !activity.reachedB2bPanel ? (
            <p className="mt-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
              Guardado en tu historial: este taller no tiene el panel de urgencias activo.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activity.shopPhone ? (
              <a
                href={`tel:${activity.shopPhone.replace(/\s+/g, '')}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
              >
                <PhoneIcon className="size-4" />
                Llamar
              </a>
            ) : null}
            {onCancel && isCancellable(activity) ? (
              <Button
                size="sm"
                variant="ghost"
                loading={cancelling}
                onClick={() => onCancel(activity)}
                className="text-urgent hover:bg-urgent-soft"
              >
                Cancelar cita
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function Detail({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-muted">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 text-ink-2">{children}</span>
    </div>
  );
}

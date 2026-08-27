/** Traducción de los estados del panel B2B al lenguaje del conductor. */
import type { BookingStatus, CustomerActivity, UrgentStatus } from '@/data/types';

export type StatusTone = 'ok' | 'warn' | 'accent' | 'muted' | 'urgent';

export interface StatusView {
  label: string;
  description: string;
  tone: StatusTone;
}

const BOOKING_STATUS: Record<BookingStatus, StatusView> = {
  pending: {
    label: 'Pendiente',
    description: 'El taller está revisando tu solicitud',
    tone: 'warn',
  },
  // El panel de derteapp guarda las reservas online como `confirmed`, que para
  // el cliente equivale a «el taller ya la tiene aceptada en su agenda».
  confirmed: { label: 'Aceptada', description: 'Confirmada en la agenda del taller', tone: 'ok' },
  accepted: { label: 'Aceptada', description: 'Confirmada en la agenda del taller', tone: 'ok' },
  in_progress: { label: 'En el taller', description: 'Están trabajando en tu coche', tone: 'accent' },
  completed: { label: 'Completada', description: 'Servicio finalizado', tone: 'muted' },
  cancelled: { label: 'Cancelada', description: 'Esta cita se anuló', tone: 'urgent' },
  no_show: { label: 'No presentada', description: 'No se acudió a la cita', tone: 'muted' },
};

const URGENT_STATUS: Record<UrgentStatus, StatusView> = {
  pending: {
    label: 'Pendiente',
    description: 'Avisado en el panel de urgencias del taller',
    tone: 'warn',
  },
  accepted: { label: 'Aceptada', description: 'El taller te atiende', tone: 'ok' },
  cancelled: { label: 'Cancelada', description: 'El taller no pudo atenderte', tone: 'urgent' },
};

export function bookingStatusView(status: BookingStatus): StatusView {
  return BOOKING_STATUS[status] ?? BOOKING_STATUS.pending;
}

export function urgentStatusView(status: UrgentStatus): StatusView {
  return URGENT_STATUS[status] ?? URGENT_STATUS.pending;
}

export function activityStatusView(activity: CustomerActivity): StatusView {
  return activity.kind === 'booking'
    ? bookingStatusView(activity.status)
    : urgentStatusView(activity.status);
}

/** Una cita está «viva» mientras no se haya cerrado ni cancelado. */
export function isOpenActivity(activity: CustomerActivity): boolean {
  if (activity.kind === 'urgent') return activity.status === 'pending' || activity.status === 'accepted';
  return !['completed', 'cancelled', 'no_show'].includes(activity.status);
}

export function isCancellable(activity: CustomerActivity): boolean {
  return activity.kind === 'booking' && isOpenActivity(activity) && activity.status !== 'in_progress';
}

export function activityTimestamp(activity: CustomerActivity): number {
  const iso = activity.kind === 'booking' ? activity.scheduledAt : activity.createdAt;
  return new Date(iso).getTime();
}

/** Próximas primero; el historial, de más reciente a más antiguo. */
export function sortActivity(items: CustomerActivity[]): {
  upcoming: CustomerActivity[];
  history: CustomerActivity[];
} {
  const upcoming: CustomerActivity[] = [];
  const history: CustomerActivity[] = [];

  for (const item of items) {
    if (isOpenActivity(item)) upcoming.push(item);
    else history.push(item);
  }

  upcoming.sort((a, b) => activityTimestamp(a) - activityTimestamp(b));
  history.sort((a, b) => activityTimestamp(b) - activityTimestamp(a));
  return { upcoming, history };
}

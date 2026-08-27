import { describe, expect, it } from 'vitest';
import type { BookingStatus, CustomerBooking, CustomerUrgentRequest } from '@/data/types';
import {
  activityStatusView,
  bookingStatusView,
  isCancellable,
  isOpenActivity,
  sortActivity,
} from './status';

function booking(overrides: Partial<CustomerBooking> = {}): CustomerBooking {
  return {
    kind: 'booking',
    id: 'b1',
    appointmentId: 'a1',
    shopId: 's1',
    shopName: 'Taller Central',
    shopPhone: null,
    shopAddress: null,
    reference: 'APT-1',
    status: 'confirmed',
    scheduledAt: '2026-09-01T08:00:00.000Z',
    durationMinutes: 60,
    serviceName: 'Cambio de aceite',
    priceEstimate: 69,
    vehicleMake: 'Seat',
    vehicleModel: 'León',
    vehiclePlate: '1234ABC',
    notes: null,
    timezone: 'Europe/Madrid',
    createdAt: '2026-08-27T10:00:00.000Z',
    ...overrides,
  };
}

function urgent(overrides: Partial<CustomerUrgentRequest> = {}): CustomerUrgentRequest {
  return {
    kind: 'urgent',
    id: 'u1',
    urgenciaId: 'urg-1',
    shopId: 's1',
    shopName: 'Taller Central',
    shopPhone: null,
    status: 'pending',
    title: 'Solicitud de servicio urgente',
    reason: 'No arranca',
    locationText: 'M-30',
    vehicleMake: null,
    vehicleModel: null,
    vehiclePlate: null,
    reachedB2bPanel: true,
    acceptedAt: null,
    createdAt: '2026-08-27T09:00:00.000Z',
    ...overrides,
  };
}

describe('bookingStatusView', () => {
  it('traduce «confirmed» del panel B2B a «Aceptada» para el conductor', () => {
    expect(bookingStatusView('confirmed').label).toBe('Aceptada');
    expect(bookingStatusView('accepted').label).toBe('Aceptada');
  });

  it('usa el rojo de marca solo para las canceladas', () => {
    expect(bookingStatusView('cancelled').tone).toBe('urgent');
    expect(bookingStatusView('pending').tone).toBe('warn');
    expect(bookingStatusView('completed').tone).toBe('muted');
  });

  it('cae en «Pendiente» ante un estado que no conoce', () => {
    expect(bookingStatusView('inventado' as BookingStatus).label).toBe('Pendiente');
  });

  it('resuelve el estado de una urgencia', () => {
    expect(activityStatusView(urgent({ status: 'accepted' })).label).toBe('Aceptada');
  });
});

describe('isOpenActivity', () => {
  it('mantiene vivas las citas que el taller aún no ha cerrado', () => {
    expect(isOpenActivity(booking({ status: 'pending' }))).toBe(true);
    expect(isOpenActivity(booking({ status: 'in_progress' }))).toBe(true);
  });

  it('cierra completadas, canceladas y no presentadas', () => {
    expect(isOpenActivity(booking({ status: 'completed' }))).toBe(false);
    expect(isOpenActivity(booking({ status: 'cancelled' }))).toBe(false);
    expect(isOpenActivity(booking({ status: 'no_show' }))).toBe(false);
  });

  it('mantiene vivas las urgencias pendientes y aceptadas', () => {
    expect(isOpenActivity(urgent({ status: 'pending' }))).toBe(true);
    expect(isOpenActivity(urgent({ status: 'accepted' }))).toBe(true);
    expect(isOpenActivity(urgent({ status: 'cancelled' }))).toBe(false);
  });
});

describe('isCancellable', () => {
  it('permite cancelar una cita pendiente o aceptada', () => {
    expect(isCancellable(booking({ status: 'pending' }))).toBe(true);
    expect(isCancellable(booking({ status: 'confirmed' }))).toBe(true);
  });

  it('no permite cancelar si el coche ya está en el taller', () => {
    expect(isCancellable(booking({ status: 'in_progress' }))).toBe(false);
  });

  it('no permite cancelar urgencias ni citas cerradas', () => {
    expect(isCancellable(urgent())).toBe(false);
    expect(isCancellable(booking({ status: 'completed' }))).toBe(false);
  });
});

describe('sortActivity', () => {
  it('separa activas de historial y ordena cada grupo', () => {
    const soon = booking({ id: 'soon', scheduledAt: '2026-08-28T08:00:00.000Z' });
    const later = booking({ id: 'later', scheduledAt: '2026-09-15T08:00:00.000Z' });
    const oldDone = booking({
      id: 'old',
      status: 'completed',
      scheduledAt: '2026-06-01T08:00:00.000Z',
    });
    const recentDone = booking({
      id: 'recent',
      status: 'cancelled',
      scheduledAt: '2026-08-01T08:00:00.000Z',
    });

    const { upcoming, history } = sortActivity([later, oldDone, soon, recentDone, urgent()]);

    expect(upcoming.map((item) => item.id)).toEqual(['u1', 'soon', 'later']);
    expect(history.map((item) => item.id)).toEqual(['recent', 'old']);
  });
});

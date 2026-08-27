import { beforeEach, describe, expect, it } from 'vitest';
import { buildAvailabilityCalendar, firstDayWithAvailability, slotLoadMap } from '@/lib/slots';
import { DemoRepository } from './demoRepository';
import type { BookingDraft, ShopListing } from './types';

const CREDENTIALS = { email: 'lucia@example.com', password: 'secreta1', fullName: 'Lucía F.' };

/** Primer hueco realmente reservable del taller, igual que hace la interfaz. */
async function firstFreeSlot(repository: DemoRepository, shop: ShopListing): Promise<string> {
  const load = slotLoadMap(
    await repository.getSlotLoad(
      shop.id,
      new Date().toISOString(),
      new Date(Date.now() + 20 * 86_400_000).toISOString(),
    ),
  );
  const calendar = buildAvailabilityCalendar(shop, load, { days: 14 });
  const day = firstDayWithAvailability(calendar);
  const slot = day?.slots.find((entry) => entry.available);
  if (!slot) throw new Error('El catálogo demo debería tener algún hueco libre');
  return slot.iso;
}

function draft(shopId: string, scheduledAt: string, overrides: Partial<BookingDraft> = {}): BookingDraft {
  return {
    shopId,
    scheduledAt,
    serviceName: 'Cambio de aceite y filtros',
    priceEstimate: 79,
    durationMinutes: 60,
    customerName: 'Lucía F.',
    customerPhone: '600123456',
    customerEmail: 'lucia@example.com',
    vehicleMake: 'Seat',
    vehicleModel: 'León',
    vehiclePlate: '1234ABC',
    vehicleYear: null,
    notes: null,
    ...overrides,
  };
}

describe('DemoRepository', () => {
  let repository: DemoRepository;
  let shop: ShopListing;

  beforeEach(async () => {
    localStorage.clear();
    repository = new DemoRepository();
    const shops = await repository.listShops();
    shop = shops[0];
  });

  it('publica un catálogo de talleres con horario y servicios', async () => {
    const shops = await repository.listShops();
    expect(shops.length).toBeGreaterThan(3);
    for (const entry of shops) {
      expect(entry.hours.length).toBeGreaterThan(0);
      expect(entry.services.length).toBeGreaterThan(0);
      expect(entry.timezone).toBeTruthy();
    }
    expect(shops.some((entry) => entry.acceptsUrgent24h)).toBe(true);
  });

  it('filtra el catálogo por ciudad', async () => {
    const madrid = await repository.listShops({ city: 'Madrid' });
    expect(madrid.length).toBeGreaterThan(0);
    expect(madrid.every((entry) => entry.city === 'Madrid')).toBe(true);
  });

  it('devuelve la ficha con opiniones y null si no existe', async () => {
    const detail = await repository.getShop(shop.id);
    expect(detail?.name).toBe(shop.name);
    expect(Array.isArray(detail?.reviews)).toBe(true);
    expect(await repository.getShop('no-existe')).toBeNull();
  });

  it('exige sesión para reservar', async () => {
    const slot = await firstFreeSlot(repository, shop);
    await expect(repository.createBooking(draft(shop.id, slot))).rejects.toThrow(/Inicia sesión/);
  });

  it('crea la cita, la deja aceptada y la devuelve en la actividad', async () => {
    await repository.signIn(CREDENTIALS);
    const slot = await firstFreeSlot(repository, shop);

    const result = await repository.createBooking(draft(shop.id, slot));
    expect(result.status).toBe('confirmed');
    expect(result.reference).toMatch(/^APT-/);
    expect(result.shopName).toBe(shop.name);

    const activity = await repository.listActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      kind: 'booking',
      shopId: shop.id,
      vehiclePlate: '1234ABC',
      serviceName: 'Cambio de aceite y filtros',
    });
  });

  it('rechaza una cita sin la antelación mínima del taller', async () => {
    await repository.signIn(CREDENTIALS);
    const tooSoon = new Date(Date.now() + 60_000).toISOString();
    await expect(repository.createBooking(draft(shop.id, tooSoon))).rejects.toThrow(/antelación/);
  });

  it('rechaza una cita fuera del horizonte de reserva', async () => {
    await repository.signIn(CREDENTIALS);
    const tooFar = new Date(Date.now() + 400 * 86_400_000).toISOString();
    await expect(repository.createBooking(draft(shop.id, tooFar))).rejects.toThrow(/calendario/);
  });

  it('bloquea el hueco cuando se agota el aforo', async () => {
    await repository.signIn(CREDENTIALS);
    const slot = await firstFreeSlot(repository, shop);

    for (let index = 0; index < shop.capacity; index += 1) {
      await repository.createBooking(draft(shop.id, slot));
    }

    await expect(repository.createBooking(draft(shop.id, slot))).rejects.toThrow(/ocuparse/);
  });

  it('cuenta la ocupación del hueco para el selector de horas', async () => {
    await repository.signIn(CREDENTIALS);
    const slot = await firstFreeSlot(repository, shop);
    await repository.createBooking(draft(shop.id, slot));

    const load = await repository.getSlotLoad(
      shop.id,
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 20 * 86_400_000).toISOString(),
    );
    expect(slotLoadMap(load).get(slot)).toBe(1);
  });

  it('cancela la cita y libera el hueco', async () => {
    await repository.signIn(CREDENTIALS);
    const slot = await firstFreeSlot(repository, shop);
    const created = await repository.createBooking(draft(shop.id, slot));

    await repository.cancelBooking(created.bookingId);

    const activity = await repository.listActivity();
    expect(activity[0]).toMatchObject({ status: 'cancelled' });
    expect(slotLoadMap(await repository.getSlotLoad(shop.id, new Date(Date.now() - 3_600_000).toISOString(), new Date(Date.now() + 20 * 86_400_000).toISOString())).get(slot)).toBeUndefined();
  });

  it('avisa si la cita ya no se puede cancelar', async () => {
    await repository.signIn(CREDENTIALS);
    const slot = await firstFreeSlot(repository, shop);
    const created = await repository.createBooking(draft(shop.id, slot));

    await repository.cancelBooking(created.bookingId);
    await expect(repository.cancelBooking(created.bookingId)).rejects.toThrow(/cerrada/);
  });

  it('registra una urgencia pendiente en un taller de 24h', async () => {
    await repository.signIn(CREDENTIALS);
    const urgentShop = (await repository.listShops()).find((entry) => entry.acceptsUrgent24h);
    expect(urgentShop).toBeDefined();

    const result = await repository.createUrgentRequest({
      shopId: urgentShop!.id,
      customerName: 'Lucía F.',
      customerPhone: '600123456',
      reason: 'No arranca',
      locationText: 'M-30 salida 12',
      vehicleMake: 'Seat',
      vehicleModel: 'León',
      vehiclePlate: '1234ABC',
    });

    expect(result.status).toBe('pending');
    expect(result.reachedB2bPanel).toBe(true);

    const activity = await repository.listActivity();
    expect(activity.some((item) => item.kind === 'urgent' && item.status === 'pending')).toBe(true);
  });

  it('pide un teléfono válido para la urgencia', async () => {
    await repository.signIn(CREDENTIALS);
    await expect(
      repository.createUrgentRequest({
        shopId: shop.id,
        customerName: 'Lucía F.',
        customerPhone: '12',
        reason: null,
        locationText: null,
        vehicleMake: null,
        vehicleModel: null,
        vehiclePlate: null,
      }),
    ).rejects.toThrow(/teléfono/);
  });

  it('guarda favoritos y vehículos del conductor', async () => {
    await repository.signIn(CREDENTIALS);

    await repository.setFavorite(shop.id, true);
    expect(await repository.listFavorites()).toEqual([shop.id]);
    await repository.setFavorite(shop.id, false);
    expect(await repository.listFavorites()).toEqual([]);

    const saved = await repository.saveVehicle({
      make: 'Seat',
      model: 'León',
      plate: '1234ABC',
      year: 2019,
      fuel: 'Diésel',
      isDefault: true,
    });
    expect(saved.id).toBeTruthy();

    const second = await repository.saveVehicle({
      make: 'Renault',
      model: 'Clio',
      plate: '5678DEF',
      year: null,
      fuel: null,
      isDefault: true,
    });

    const vehicles = await repository.listVehicles();
    expect(vehicles).toHaveLength(2);
    expect(vehicles.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual([second.id]);

    await repository.removeVehicle(saved.id);
    expect(await repository.listVehicles()).toHaveLength(1);
  });

  it('publica una opinión que se ve en la ficha del taller', async () => {
    await repository.signIn(CREDENTIALS);
    const before = (await repository.getShop(shop.id))!.reviews.length;

    await repository.submitReview({ shopId: shop.id, rating: 5, comment: 'Impecable', serviceTag: null });

    const detail = (await repository.getShop(shop.id))!;
    expect(detail.reviews).toHaveLength(before + 1);
    expect(detail.reviews[0]).toMatchObject({ authorName: 'Lucía F.', rating: 5 });
  });

  it('avisa a las pantallas suscritas cuando cambia la actividad', async () => {
    await repository.signIn(CREDENTIALS);
    let notifications = 0;
    const unsubscribe = repository.subscribeToActivity(() => {
      notifications += 1;
    });

    const slot = await firstFreeSlot(repository, shop);
    await repository.createBooking(draft(shop.id, slot));
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
    const previous = notifications;
    await repository.setFavorite(shop.id, true);
    expect(notifications).toBe(previous);
  });

  it('mantiene la sesión y los datos entre recargas', async () => {
    await repository.signIn(CREDENTIALS);
    const slot = await firstFreeSlot(repository, shop);
    await repository.createBooking(draft(shop.id, slot));

    const reopened = new DemoRepository();
    expect((await reopened.getProfile())?.email).toBe(CREDENTIALS.email);
    expect(await reopened.listActivity()).toHaveLength(1);

    await reopened.signOut();
    expect(await reopened.getProfile()).toBeNull();
    expect(await reopened.listActivity()).toEqual([]);
  });
});

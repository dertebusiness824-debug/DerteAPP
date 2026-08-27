import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

const STORAGE_KEY = 'derteapp-marketplace-demo-v1';

/** Deja una sesión abierta en el catálogo demo, como tras entrar en la cuenta. */
function seedSignedInCustomer() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      profile: {
        id: 'demo-customer-test',
        fullName: 'Lucía Fernández',
        email: 'lucia@example.com',
        phone: '600123456',
        city: 'Madrid',
      },
      vehicles: [],
      favorites: [],
      bookings: [],
      urgent: [],
    }),
  );
}

async function renderApp() {
  window.history.pushState({}, '', '/');
  const user = userEvent.setup();
  render(<App />);
  // La home espera al arranque del repositorio antes de pintar el listado.
  await waitFor(() => expect(screen.getByLabelText('Buscar taller o servicio')).toBeInTheDocument());
  return user;
}

/** Abre la ficha del primer taller del listado y devuelve su nombre. */
async function openFirstShop(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  const cards = await screen.findAllByRole('article');
  const name = within(cards[0]).getByRole('heading').textContent ?? '';
  await user.click(within(cards[0]).getByRole('link'));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name));
  return name;
}

describe('PWA de clientes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('arranca en modo demo y lista talleres cercanos con su estado', async () => {
    await renderApp();

    expect(screen.getByText('Catálogo de demostración')).toBeInTheDocument();
    const cards = await screen.findAllByRole('article');
    expect(cards.length).toBeGreaterThan(2);

    // Cada tarjeta trae nombre, valoración, estado y (al menos una) urgencias 24h.
    expect(within(cards[0]).getByRole('heading')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/de 5/)).toBeInTheDocument();
    expect(screen.getAllByText('Urgencias 24h').length).toBeGreaterThan(0);
    expect(screen.getByText(/talleres en Madrid/i)).toBeInTheDocument();
  });

  it('busca por servicio en lenguaje natural', async () => {
    const user = await renderApp();
    const before = (await screen.findAllByRole('article')).length;

    await user.type(screen.getByLabelText('Buscar taller o servicio'), 'neumáticos');

    await waitFor(async () => {
      const after = await screen.findAllByRole('article');
      expect(after.length).toBeLessThan(before);
      expect(after.length).toBeGreaterThan(0);
    });
  });

  it('deja el listado vacío con un mensaje útil cuando nada encaja', async () => {
    const user = await renderApp();
    await user.type(screen.getByLabelText('Buscar taller o servicio'), 'reparación de submarinos');

    expect(await screen.findByText('No hay talleres con esos filtros')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect((await screen.findAllByRole('article')).length).toBeGreaterThan(0);
  });

  it('abre la ficha del taller con horario, precios y la doble acción', async () => {
    const user = await renderApp();
    await openFirstShop(user);

    expect(screen.getByText('Horario')).toBeInTheDocument();
    expect(screen.getByText('Servicios y precios orientativos')).toBeInTheDocument();
    expect(screen.getByText('Opiniones de clientes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cómo llegar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reservar cita/ })).toBeInTheDocument();
  });

  it('pide identificarse antes de confirmar la reserva', async () => {
    const user = await renderApp();
    await openFirstShop(user);

    await user.click(screen.getByRole('button', { name: /^Reservar cita$/ }));
    await user.click(await screen.findByRole('button', { name: 'Continuar' }));

    const slot = await waitFor(() => {
      const buttons = screen
        .getAllByRole('button')
        .filter((button) => /^\d{2}:\d{2}$/.test(button.textContent ?? '') && !button.hasAttribute('disabled'));
      expect(buttons.length).toBeGreaterThan(0);
      return buttons[0];
    });
    await user.click(slot);
    await user.click(screen.getByRole('button', { name: /^Continuar ·/ }));

    await user.type(screen.getByLabelText(/^Marca/), 'Seat');
    await user.type(screen.getByLabelText(/^Modelo/), 'León');
    await user.type(screen.getByLabelText(/^Matrícula/), '1234ABC');
    await user.type(screen.getByLabelText(/^Tu nombre/), 'Lucía Fernández');
    await user.type(screen.getByLabelText(/^Teléfono/), '600123456');

    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

    expect(await screen.findByText('Entra en tu cuenta para confirmar la reserva')).toBeInTheDocument();
  });

  it('completa la reserva y la deja visible en «Mis citas»', async () => {
    seedSignedInCustomer();
    const user = await renderApp();
    const shopName = await openFirstShop(user);

    await user.click(screen.getByRole('button', { name: /^Reservar cita$/ }));

    // 1) Servicio
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Otra cosa / no lo sé'));
    await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    // 2) Día y hora reales
    const slot = await waitFor(() => {
      const buttons = within(dialog)
        .getAllByRole('button')
        .filter((button) => /^\d{2}:\d{2}$/.test(button.textContent ?? '') && !button.hasAttribute('disabled'));
      expect(buttons.length).toBeGreaterThan(0);
      return buttons[0];
    });
    const slotLabel = slot.textContent ?? '';
    await user.click(slot);

    // 3) Vehículo y contacto (nombre y teléfono llegan del perfil)
    await user.click(within(dialog).getByRole('button', { name: /^Continuar ·/ }));
    await user.type(within(dialog).getByLabelText(/^Marca/), 'Seat');
    await user.type(within(dialog).getByLabelText(/^Modelo/), 'León');
    await user.type(within(dialog).getByLabelText(/^Matrícula/), '1234abc');

    // 4) Confirmación
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar reserva' }));

    expect(await screen.findByText('Reserva confirmada')).toBeInTheDocument();
    expect(screen.getByText('Aceptada')).toBeInTheDocument();
    expect(screen.getByText(/1234 ABC/)).toBeInTheDocument();

    // La cita ya está en «Mis citas», con el estado que verá el taller.
    await user.click(screen.getByRole('button', { name: 'Ver mis citas' }));

    const activity = await screen.findByRole('article');
    expect(within(activity).getByRole('link', { name: shopName })).toBeInTheDocument();
    expect(within(activity).getByText('Aceptada')).toBeInTheDocument();
    expect(within(activity).getByText(new RegExp(slotLabel))).toBeInTheDocument();
    expect(within(activity).getByText(/Seat León · 1234 ABC/)).toBeInTheDocument();
  });

  it('envía un aviso urgente al panel de urgencias del taller', async () => {
    seedSignedInCustomer();
    const user = await renderApp();

    // Se filtra por urgencias 24h para asegurar un taller con el servicio activo.
    await user.click(screen.getByRole('button', { name: /Urgencias 24h/ }));
    await openFirstShop(user);

    await user.click(screen.getByRole('button', { name: /Asistencia urgente/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'No arranca' }));
    await user.click(within(dialog).getByRole('button', { name: /Enviar aviso urgente/ }));

    expect(await screen.findByText('Urgencia registrada')).toBeInTheDocument();
    expect(
      screen.getByText(/La alerta ya suena en el panel de urgencias del taller/),
    ).toBeInTheDocument();
  });

  it('guarda un taller en favoritos y lo muestra en su pestaña', async () => {
    seedSignedInCustomer();
    const user = await renderApp();

    const cards = await screen.findAllByRole('article');
    const shopName = within(cards[0]).getByRole('heading').textContent ?? '';
    await user.click(within(cards[0]).getByRole('button', { name: /Guardar .* en favoritos/ }));

    await user.click(screen.getByRole('link', { name: /Favoritos/ }));
    // La pantalla llega en su propio trozo: se espera a su cabecera.
    await screen.findByText('1 taller guardado');

    const favorites = screen.getAllByRole('article');
    expect(favorites).toHaveLength(1);
    expect(within(favorites[0]).getByRole('heading')).toHaveTextContent(shopName);
  });

  it('permite registrar un vehículo desde el perfil', async () => {
    seedSignedInCustomer();
    const user = await renderApp();

    await user.click(screen.getByRole('link', { name: /Perfil/ }));
    expect(await screen.findByText('Sin vehículos registrados')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Añadir/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Marca/), 'Renault');
    await user.type(within(dialog).getByLabelText(/^Modelo/), 'Clio');
    await user.type(within(dialog).getByLabelText(/^Matrícula/), '5678DEF');
    await user.click(within(dialog).getByRole('button', { name: 'Añadir vehículo' }));

    expect(await screen.findByText('Renault Clio')).toBeInTheDocument();
    expect(screen.getByText(/5678 DEF/)).toBeInTheDocument();
    expect(screen.getByText('Habitual')).toBeInTheDocument();
  });
});

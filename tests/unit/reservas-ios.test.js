import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appointmentRow } from '../../public/js/views/appointments.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const shell = readFileSync(path.join(root, 'public/js/shell.js'), 'utf8');

describe('reservas iOS list theme', () => {
  it('keeps booking data bindings and splits the vehicle onto its own line', () => {
    const html = appointmentRow({
      id: 'appt-1',
      customer_name: 'María López',
      customer_email: 'maria@example.com',
      status: 'confirmed',
      scheduled_at: '2026-08-25T09:00:00.000Z',
      timezone: 'Europe/Madrid',
      service_type: 'Revisión',
      vehicle: { label: 'BMW e46', plate: '5555 WWW' },
    });

    assert.match(html, /data-booking-row="appt-1"/);
    assert.match(html, /data-appointment="appt-1"/);
    assert.match(html, /data-cancel="appt-1"/);
    assert.match(html, /María López/);
    assert.match(html, /maria@example.com/);
    assert.match(html, /Revisión/);
    assert.match(html, /class="[^"]*reservas-card__vehicle[^"]*"/);
    assert.match(html, /BMW e46 · 5555 WWW/);
    assert.match(html, /Cancelar reserva|Cancel booking/);
    assert.match(html, />\s*Detalles\s*</);
  });

  it('hides Cancel on completed bookings and keeps Detalles', () => {
    const html = appointmentRow({
      id: 'appt-2',
      customer_name: 'Luis',
      status: 'completed',
      scheduled_at: '2026-08-20T09:00:00.000Z',
      timezone: 'Europe/Madrid',
    });
    assert.doesNotMatch(html, /data-cancel=/);
    assert.match(html, />\s*Detalles\s*</);
  });

  it('scopes the pale-sky theme to the reservas shell', () => {
    assert.match(shell, /classList\.toggle\('app--reservas', isReservas\)/);
    assert.match(shell, /classList\.toggle\('nav--reservas', isReservas\)/);
    assert.match(css, /--reservas-sky:\s*#e3f2fd/);
    assert.match(css, /\.app--reservas \.chip\[aria-pressed='true'\]\s*\{[^}]*background:\s*#2196f3/s);
    assert.match(css, /\.app--reservas \.badge--ok\s*\{[^}]*color:\s*#2196f3/s);
    assert.match(css, /\.nav--reservas\s*\{[^}]*background:\s*#e3f2fd/s);
    assert.match(css, /\.app--reservas \.reservas-card__cancel\s*\{[^}]*background:\s*#fde8ee/s);
    assert.match(css, /\.app--reservas \.reservas-card__details\s*\{[^}]*color:\s*#2196f3/s);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reauthPanel } from '../../public/js/session-errors.js';

describe('session-errors soft panel', () => {
  it('never renders Iniciar Sesión de Nuevo or load-error copy', () => {
    const html = reauthPanel({
      title: 'No se pudieron cargar las reservas',
      body: 'Prueba a iniciar sesión de nuevo.',
    });
    assert.match(html, /No hay reservas en esta categoría/);
    assert.doesNotMatch(html, /Iniciar Sesión de Nuevo/);
    assert.doesNotMatch(html, /No se pudieron cargar las reservas/);
    assert.doesNotMatch(html, /data-reauth[^=]/);
  });
});

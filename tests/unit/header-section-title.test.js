import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

describe('sectionTitleFromPath', () => {
  let sectionTitleFromPath;
  let previousLocale;

  before(async () => {
    const i18n = await import('../../public/js/i18n.js');
    previousLocale = i18n.getLocale();
    i18n.setLocale('es');
    ({ sectionTitleFromPath } = await import('../../public/js/shell.js'));
  });

  after(async () => {
    if (previousLocale) {
      const i18n = await import('../../public/js/i18n.js');
      i18n.setLocale(previousLocale);
    }
  });

  it('maps owner routes to clean section names (no shop/user)', () => {
    assert.equal(sectionTitleFromPath('/'), 'Inicio');
    assert.equal(sectionTitleFromPath('/dashboard'), 'Inicio');
    assert.equal(sectionTitleFromPath('/appointments'), 'Reservas');
    assert.equal(sectionTitleFromPath('/appointments/abc'), 'Reservas');
    assert.equal(sectionTitleFromPath('/reservas'), 'Reservas');
    assert.equal(sectionTitleFromPath('/reservas/abc'), 'Reservas');
    assert.equal(sectionTitleFromPath('/urgencias'), 'Urgencias');
    assert.equal(sectionTitleFromPath('/urgencias/xyz'), 'Urgencias');
    assert.equal(sectionTitleFromPath('/settings'), 'Ajustes');
    assert.equal(sectionTitleFromPath('/settings/shop'), 'Ajustes');
    assert.equal(sectionTitleFromPath('/vehiculos'), 'Vehículos');
    assert.equal(sectionTitleFromPath('/vehiculos/abc'), 'Vehículos');
    assert.equal(sectionTitleFromPath('/diagnostico'), 'Diagnóstico');
    assert.equal(sectionTitleFromPath('/inventario'), 'Inventario');
    assert.equal(sectionTitleFromPath('/web'), 'Web');
    assert.equal(sectionTitleFromPath('/insights'), 'Estadísticas');
  });

  it('titles a chat thread as the Super Admin inbox, the only way in now', () => {
    assert.equal(sectionTitleFromPath('/chat/some-thread-id'), 'Bandeja');
  });

  it('maps super-admin routes to section names', () => {
    assert.equal(sectionTitleFromPath('/admin'), 'Resumen');
    assert.equal(sectionTitleFromPath('/admin/shops'), 'Talleres');
    assert.equal(sectionTitleFromPath('/admin/commissions'), 'Comisiones');
    assert.equal(sectionTitleFromPath('/admin/users'), 'Cuentas');
    assert.equal(sectionTitleFromPath('/admin/inbox'), 'Bandeja');
    assert.equal(sectionTitleFromPath('/admin/calls'), 'Llamadas');
  });
});

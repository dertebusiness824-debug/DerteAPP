import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import config from '../../server/config.js';
import {
  extractPlatformLead,
  isCompletePlatformLead,
  isPlatformLeadCall,
  missingPlatformLeadFields,
  normalizeIsland,
} from '../../server/services/retell.js';

describe('normalizeIsland', () => {
  it('canonicalizes Canary island names from loose text', () => {
    assert.equal(normalizeIsland('gran canaria'), 'Gran Canaria');
    assert.equal(normalizeIsland('Las Palmas de Gran Canaria'), 'Gran Canaria');
    assert.equal(normalizeIsland('tenerife sur'), 'Tenerife');
    assert.equal(normalizeIsland('Santa Cruz de Tenerife'), 'Tenerife');
    assert.equal(normalizeIsland('Lanzarote'), 'Lanzarote');
    assert.equal(normalizeIsland('Fuerteventura'), 'Fuerteventura');
    assert.equal(normalizeIsland('la palma'), 'La Palma');
    assert.equal(normalizeIsland('La Gomera'), 'La Gomera');
    assert.equal(normalizeIsland('El Hierro'), 'El Hierro');
  });

  it('keeps unknown places and ignores empty values', () => {
    assert.equal(normalizeIsland('Menorca'), 'Menorca');
    assert.equal(normalizeIsland('  '), null);
    assert.equal(normalizeIsland(null), null);
  });
});

describe('extractPlatformLead', () => {
  it('reads Spanish Retell fields: nombre, nombre_taller, isla', () => {
    const lead = extractPlatformLead({
      call_id: 'lead-es-1',
      agent_id: 'agent_sales',
      from_number: '+34655110022',
      call_analysis: {
        call_summary: 'Quiere probar DerteApp en su taller.',
        custom_analysis_data: {
          nombre: 'Ana Pérez García',
          nombre_taller: 'Talleres Sol',
          isla: 'gran canaria',
          telefono: '+34655110022',
        },
      },
    });

    assert.equal(lead.customer_name, 'Ana Pérez García');
    assert.equal(lead.shop_name, 'Talleres Sol');
    assert.equal(lead.island, 'Gran Canaria');
    assert.equal(lead.customer_phone, '+34655110022');
    assert.equal(lead.vehicle, null);
    assert.equal(lead.plate, null);
  });

  it('falls back to English aliases and the call summary for the island', () => {
    const lead = extractPlatformLead({
      call_id: 'lead-en-1',
      from_number: '+34666777888',
      call_analysis: {
        custom_analysis_data: {
          customer_name: 'Luis Morales',
          workshop_name: 'Taller Morales',
        },
        call_summary: 'Called from Tenerife about joining DerteApp.',
      },
    });

    assert.equal(lead.customer_name, 'Luis Morales');
    assert.equal(lead.shop_name, 'Taller Morales');
    assert.equal(lead.island, 'Tenerife');
  });
});

describe('isPlatformLeadCall', () => {
  it('treats dedicated platform agent / DID / metadata as a sales lead', () => {
    const previousAgent = config.retell.platformAgentId;
    const previousDid = config.retell.platformDid;
    config.retell.platformAgentId = 'agent_platform_sales';
    config.retell.platformDid = '+34911111111';
    try {
      assert.equal(isPlatformLeadCall({ agent_id: 'agent_platform_sales' }, {}), true);
      assert.equal(isPlatformLeadCall({ to_number: '+34 911 111 111' }, {}), true);
      assert.equal(isPlatformLeadCall({ metadata: { purpose: 'clientes' } }, {}), true);
      assert.equal(isPlatformLeadCall({ metadata: { kind: 'captacion' } }, {}), true);
    } finally {
      config.retell.platformAgentId = previousAgent;
      config.retell.platformDid = previousDid;
    }
  });

  it('uses taller + isla without a vehicle even when a shop DID also matched', () => {
    assert.equal(
      isPlatformLeadCall(
        {},
        { shop_name: 'Talleres Sol', island: 'Gran Canaria', vehicle: null, plate: null },
        { shopMatched: true },
      ),
      true,
    );
  });

  it('does not steal workshop Urgencias that carry a vehicle or plate', () => {
    assert.equal(
      isPlatformLeadCall(
        { agent_id: 'agent_test_shop' },
        { shop_name: null, island: null, vehicle: 'Seat Ibiza', plate: '1234BCD' },
        { shopMatched: true },
      ),
      false,
    );
    assert.equal(
      isPlatformLeadCall(
        { agent_id: 'agent_test_shop' },
        { shop_name: 'Taller', island: 'Tenerife', vehicle: 'Ford Focus', plate: null },
        { shopMatched: true },
      ),
      false,
    );
  });

  it('accepts an unmatched shop when the caller still named a taller or island', () => {
    assert.equal(
      isPlatformLeadCall({}, { shop_name: 'Nuevo Taller', island: null }, { shopMatched: false }),
      true,
    );
  });
});

describe('isCompletePlatformLead', () => {
  const complete = {
    customer_name: 'Ana Pérez',
    shop_name: 'Talleres Sol',
    island: 'Gran Canaria',
    customer_phone: '+34655110022',
  };

  it('requires nombre, taller, isla and teléfono', () => {
    assert.equal(isCompletePlatformLead(complete), true);
    assert.deepEqual(missingPlatformLeadFields(complete), []);
  });

  it('rejects empty or whitespace-only required fields', () => {
    assert.deepEqual(missingPlatformLeadFields({ ...complete, customer_name: '  ' }), ['nombre_cliente']);
    assert.deepEqual(missingPlatformLeadFields({ ...complete, shop_name: '' }), ['taller']);
    assert.deepEqual(missingPlatformLeadFields({ ...complete, island: null }), ['isla']);
    assert.deepEqual(missingPlatformLeadFields({ ...complete, customer_phone: '' }), ['telefono']);
  });

  it('rejects Retell placeholder names', () => {
    assert.equal(isCompletePlatformLead({ ...complete, customer_name: 'The user' }), false);
    assert.equal(isCompletePlatformLead({ ...complete, customer_name: 'Sin nombre' }), false);
    assert.deepEqual(missingPlatformLeadFields({ ...complete, customer_name: 'Cliente' }), [
      'nombre_cliente',
    ]);
  });

  it('rejects a phone without enough digits', () => {
    assert.equal(isCompletePlatformLead({ ...complete, customer_phone: '+' }), false);
    assert.equal(isCompletePlatformLead({ ...complete, customer_phone: '12' }), false);
  });
});

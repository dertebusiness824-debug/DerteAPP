import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  REASONS,
  lookupPlate,
  mapOfficialVehicle,
  pick,
  unwrapPayload,
} from '../../server/services/matriculas.js';

const SEAT = {
  marca: 'SEAT',
  modelo: 'Leon',
  version: '2.0 TDI 150 Style DSG',
  combustible: 'diésel',
  potencia: 150,
  motor: '2.0 TDI CR',
  cilindrada: 1968,
  anio: 2018,
  vin: 'VSSZZZ5FZJR123456',
  tecdoc: '11873',
  fechaMatriculacion: '2018-03-12',
  carroceria: 'hatchback',
};

describe('Matriculas.org payload mapping', () => {
  it('reads Spanish field names', () => {
    const vehicle = mapOfficialVehicle(SEAT, '1234BCD');
    assert.equal(vehicle.make, 'SEAT');
    assert.equal(vehicle.model, 'Leon');
    assert.equal(vehicle.version, '2.0 TDI 150 Style DSG');
    assert.equal(vehicle.year, 2018);
    assert.equal(vehicle.fuel, 'diésel');
    assert.equal(vehicle.power_hp, 150);
    assert.equal(vehicle.official.vin, 'VSSZZZ5FZJR123456');
    assert.equal(vehicle.specs.tecdoc, '11873');
    assert.equal(vehicle.specs.displacement_cc, 1968);
  });

  it('unwraps RapidAPI { data: AWN_* } payloads', () => {
    const vehicle = mapOfficialVehicle(
      {
        message: 'Success',
        data: {
          AWN_marque: 'CITROËN',
          AWN_modele: 'C3',
          AWN_version: '1.2 PureTech 82',
          AWN_energie: 'ESSENCE',
          AWN_puissance_chevaux: '82',
          AWN_code_moteur: 'EB2F',
          AWN_date_mise_en_circulation_us: '2015-06-01',
          AWN_style_carrosserie: 'hatch',
          AWN_VIN: 'VF7XXXXXXXXXXXXXX',
          AWN_k_type: '9901',
        },
      },
      '5678FGH',
    );
    assert.equal(vehicle.make, 'CITROËN');
    assert.equal(vehicle.model, 'C3');
    assert.equal(vehicle.year, 2015);
    assert.equal(vehicle.body, 'hatchback');
    assert.equal(vehicle.official.tecdoc, '9901');
  });

  it('returns null when marca and modelo are both missing', () => {
    assert.equal(mapOfficialVehicle({ error: true, message: 'not found' }, '1234BCD'), null);
  });

  it('picks the first populated key', () => {
    assert.equal(pick({ marca: 'SEAT', make: 'Seat' }, ['make', 'marca']), 'Seat');
    assert.equal(pick({ marca: 'SEAT' }, ['make', 'marca']), 'SEAT');
    assert.equal(pick({}, ['make']), null);
  });

  it('flattens AWN_ prefixes when unwrapping', () => {
    const data = unwrapPayload({ data: { AWN_marque: 'FORD' } });
    assert.equal(data.marque, 'FORD');
    assert.equal(data.AWN_marque, 'FORD');
  });
});

describe('lookupPlate', () => {
  const previous = process.env.MATRICULAS_API_KEY;

  after(() => {
    if (previous === undefined) delete process.env.MATRICULAS_API_KEY;
    else process.env.MATRICULAS_API_KEY = previous;
  });

  it('refuses to call the network without a key', async () => {
    delete process.env.MATRICULAS_API_KEY;
    delete process.env.PLATE_LOOKUP_API_KEY;
    let called = false;
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => SEAT };
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_configured');
    assert.match(REASONS.not_configured, /MATRICULAS_API_KEY/);
  });

  it('maps a successful RapidAPI reply', async () => {
    process.env.MATRICULAS_API_KEY = 'test-key';
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async (url, options) => {
        assert.match(String(url), /plate=1234BCD/);
        assert.equal(options.headers['X-RapidAPI-Key'], 'test-key');
        assert.equal(options.headers['X-RapidAPI-Host'], 'api-license-plate.p.rapidapi.com');
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: SEAT }),
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.found, true);
    assert.equal(result.vehicle.make, 'SEAT');
    assert.equal(result.vehicle.source, 'matriculas');
    assert.equal(result.official.vin, 'VSSZZZ5FZJR123456');
  });

  it('treats an empty register hit as not_found, not a crash', async () => {
    process.env.MATRICULAS_API_KEY = 'test-key';
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.found, false);
    assert.equal(result.reason, 'not_found');
    assert.equal(result.vehicle, null);
  });

  it('maps HTTP 404 to not_found', async () => {
    process.env.MATRICULAS_API_KEY = 'test-key';
    const result = await lookupPlate('9999ZZZ', {
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Plate not found' }),
      }),
    });
    assert.equal(result.found, false);
    assert.equal(result.reason, 'not_found');
  });

  it('maps HTTP 429 to quota_exceeded', async () => {
    process.env.MATRICULAS_API_KEY = 'test-key';
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ message: 'You have exceeded the MONTHLY quota' }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'quota_exceeded');
  });

  it('maps a timeout abort to timeout', async () => {
    process.env.MATRICULAS_API_KEY = 'test-key';
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
    });
    assert.equal(result.reason, 'timeout');
  });

  it('rejects an unusable plate before calling the provider', async () => {
    process.env.MATRICULAS_API_KEY = 'test-key';
    let called = false;
    const result = await lookupPlate('!!', {
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.equal(called, false);
    assert.equal(result.reason, 'invalid_plate');
  });
});

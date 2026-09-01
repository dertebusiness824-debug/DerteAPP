/**
 * APIVehículo payload mapping and lookupPlate (no network).
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  REASONS,
  lookupPlate,
  mapOfficialVehicle,
  pick,
  probeConnection,
  resetKeyStateForTests,
  unwrapPayload,
} from '../../server/services/apivehiculo.js';

const CLIO = {
  code: 200,
  message: 'OK',
  data: {
    plate: '5847GKZ',
    country: 'ES',
    brand: 'RENAULT',
    model: 'Clio',
    modelEn: 'CLIO III',
    version: '2.0 16V',
    firstRegistrationDate: '2008-01-25',
    fuelType: 'Gasoline',
    powerKW: '145',
    powerHP: '197',
    vin: 'VF1XXXXXXXXXXXXXX',
  },
};

describe('APIVehículo payload mapping', () => {
  it('reads the official { data: brand/model } JSON', () => {
    const vehicle = mapOfficialVehicle(CLIO, '5847GKZ');
    assert.equal(vehicle.make, 'RENAULT');
    assert.equal(vehicle.model, 'Clio');
    assert.equal(vehicle.version, '2.0 16V');
    assert.equal(vehicle.year, 2008);
    assert.equal(vehicle.fuel, 'gasolina');
    assert.equal(vehicle.power_hp, 197);
    assert.equal(vehicle.official.vin, 'VF1XXXXXXXXXXXXXX');
    assert.equal(vehicle.official.power_kw, 145);
    assert.equal(vehicle.official.provider, 'apivehiculo.com');
  });

  it('also reads Spanish field names', () => {
    const vehicle = mapOfficialVehicle(
      { marca: 'SEAT', modelo: 'Leon', potencia: 150, anio: 2018, combustible: 'diésel' },
      '1234BCD',
    );
    assert.equal(vehicle.make, 'SEAT');
    assert.equal(vehicle.model, 'Leon');
    assert.equal(vehicle.year, 2018);
    assert.equal(vehicle.fuel, 'diésel');
    assert.equal(vehicle.power_hp, 150);
  });

  it('returns null when brand and model are both missing', () => {
    assert.equal(mapOfficialVehicle({ error: true, message: 'not found' }, '1234BCD'), null);
  });

  it('picks the first populated key', () => {
    assert.equal(pick({ brand: 'Seat', marca: 'SEAT' }, ['brand', 'marca']), 'Seat');
    assert.equal(pick({ marca: 'SEAT' }, ['brand', 'marca']), 'SEAT');
    assert.equal(pick({}, ['brand']), null);
  });

  it('unwraps { data } envelopes', () => {
    const data = unwrapPayload({ code: 200, data: { brand: 'FORD' } });
    assert.equal(data.brand, 'FORD');
  });
});

describe('lookupPlate', () => {
  const previous = process.env.API_VEHICULO_KEY;
  const previousAlias = process.env.APIVEHICULO_API_KEY;

  beforeEach(() => {
    resetKeyStateForTests();
    delete process.env.API_VEHICULO_KEY;
    delete process.env.APIVEHICULO_API_KEY;
  });

  after(() => {
    resetKeyStateForTests();
    if (previous === undefined) delete process.env.API_VEHICULO_KEY;
    else process.env.API_VEHICULO_KEY = previous;
    if (previousAlias === undefined) delete process.env.APIVEHICULO_API_KEY;
    else process.env.APIVEHICULO_API_KEY = previousAlias;
  });

  it('refuses to call the network without a key', async () => {
    delete process.env.API_VEHICULO_KEY;
    delete process.env.APIVEHICULO_API_KEY;
    let called = false;
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => CLIO };
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_configured');
    assert.match(REASONS.not_configured, /API_VEHICULO_KEY/);
  });

  it('sends a Bearer token to the official lookup URL', async () => {
    process.env.API_VEHICULO_KEY = 'test-key';
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async (url, options) => {
        assert.match(String(url), /api\.apivehiculo\.com\/v1\/lookup/);
        assert.match(String(url), /plate=1234BCD/);
        assert.match(String(url), /country=ES/);
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        assert.equal(options.headers['X-RapidAPI-Key'], undefined);
        return {
          ok: true,
          status: 200,
          json: async () => CLIO,
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.found, true);
    assert.equal(result.vehicle.make, 'RENAULT');
    assert.equal(result.vehicle.source, 'apivehiculo');
    assert.equal(result.official.provider, 'apivehiculo.com');
  });

  it('strips an existing Bearer prefix on the key', async () => {
    process.env.API_VEHICULO_KEY = 'Bearer already-prefixed';
    await lookupPlate('1234BCD', {
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer already-prefixed');
        return { ok: true, status: 200, json: async () => CLIO };
      },
    });
  });

  it('treats an empty register hit as not_found, not a crash', async () => {
    process.env.API_VEHICULO_KEY = 'test-key';
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
    process.env.API_VEHICULO_KEY = 'test-key';
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

  it('maps HTTP 401 to invalid_key', async () => {
    process.env.API_VEHICULO_KEY = 'test-key';
    const result = await lookupPlate('1234BCD', {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_key');
  });

  it('maps HTTP 429 to quota_exceeded', async () => {
    process.env.API_VEHICULO_KEY = 'test-key';
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
    process.env.API_VEHICULO_KEY = 'test-key';
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
    process.env.API_VEHICULO_KEY = 'test-key';
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

describe('probeConnection', () => {
  const previous = process.env.API_VEHICULO_KEY;

  beforeEach(() => {
    resetKeyStateForTests();
    delete process.env.API_VEHICULO_KEY;
    delete process.env.APIVEHICULO_API_KEY;
  });

  after(() => {
    resetKeyStateForTests();
    if (previous === undefined) delete process.env.API_VEHICULO_KEY;
    else process.env.API_VEHICULO_KEY = previous;
  });

  it('reports not_configured without calling the network', async () => {
    delete process.env.API_VEHICULO_KEY;
    delete process.env.APIVEHICULO_API_KEY;
    let called = false;
    const result = await probeConnection({
      fetchImpl: async () => {
        called = true;
        return { status: 200 };
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_configured');
  });

  it('treats HTTP 404 as a healthy connection (key accepted)', async () => {
    process.env.API_VEHICULO_KEY = 'test-key';
    const result = await probeConnection({
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        return { status: 404 };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.configured, true);
  });

  it('treats HTTP 401 as an invalid key', async () => {
    process.env.API_VEHICULO_KEY = 'test-key';
    const result = await probeConnection({
      fetchImpl: async () => ({ status: 401 }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_key');
  });
});

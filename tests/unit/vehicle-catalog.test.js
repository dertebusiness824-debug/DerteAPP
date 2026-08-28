import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BODY_TYPES,
  CATALOG_ENTRIES,
  CATALOG_MAKES,
  catalogEntryByKey,
  modelsForMake,
  photoForBody,
  searchCatalog,
} from '../../server/lib/vehicle-catalog.js';

describe('vehicle catalog shape', () => {
  it('gives every version a unique key, which is what the UI posts back', () => {
    const keys = CATALOG_ENTRIES.map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('gives every version a photo and a body type the app can render', () => {
    for (const entry of CATALOG_ENTRIES) {
      assert.ok(BODY_TYPES.includes(entry.body), `${entry.key} has body ${entry.body}`);
      assert.match(entry.photo_url, /^\/img\/vehicles\/.+\.svg$/);
    }
  });

  it('falls back to a generic illustration for an unknown body', () => {
    assert.equal(photoForBody('submarino'), '/img/vehicles/hatchback.svg');
    assert.equal(photoForBody(null), '/img/vehicles/hatchback.svg');
  });

  it('keeps year ranges coherent, so a year hint can be trusted', () => {
    for (const entry of CATALOG_ENTRIES) {
      if (entry.year_from === null || entry.year_to === null) continue;
      assert.ok(entry.year_from <= entry.year_to, `${entry.key} has an inverted year range`);
    }
  });

  it('lists makes alphabetically and models per make', () => {
    assert.deepEqual([...CATALOG_MAKES].sort((a, b) => a.localeCompare(b, 'es')), CATALOG_MAKES);
    assert.ok(modelsForMake('SEAT').includes('Ibiza'));
    // The make lookup is case-insensitive, as typed at the counter.
    assert.deepEqual(modelsForMake('seat'), modelsForMake('SEAT'));
    assert.deepEqual(modelsForMake('Batmóvil'), []);
  });
});

describe('searchCatalog', () => {
  it('finds a car from free text as the counter would type it', () => {
    const [best] = searchCatalog({ text: 'seat ibiza' });
    assert.equal(best.make, 'SEAT');
    assert.equal(best.model, 'Ibiza');
    assert.equal(best.match, 1);
  });

  it('ignores accents and capitals', () => {
    const a = searchCatalog({ text: 'CITROËN' }).map((entry) => entry.key);
    const b = searchCatalog({ text: 'citroen' }).map((entry) => entry.key);
    assert.deepEqual(a, b);
    assert.ok(a.length > 0);
  });

  it('prefers the version whose production years contain the given year', () => {
    const results = searchCatalog({ make: 'SEAT', model: 'Ibiza', year: 2012, limit: 20 });
    assert.ok(results.length > 0);
    const top = results[0];
    if (top.year_from && top.year_to) {
      assert.ok(top.year_from <= 2012 && top.year_to >= 2012, `${top.key} does not cover 2012`);
    }
  });

  it('is deterministic and respects the limit', () => {
    const query = { text: 'golf', limit: 3 };
    const first = searchCatalog(query).map((entry) => entry.key);
    assert.ok(first.length <= 3);
    assert.deepEqual(searchCatalog(query).map((entry) => entry.key), first);
  });

  it('returns nothing rather than a random car when there is no match', () => {
    assert.deepEqual(searchCatalog({ text: 'zzzzqqq' }), []);
    assert.deepEqual(searchCatalog({}), []);
  });

  it('scores every hit relative to the best one', () => {
    const results = searchCatalog({ text: 'volkswagen golf', limit: 6 });
    assert.equal(results[0].match, 1);
    for (const entry of results) {
      assert.ok(entry.match > 0 && entry.match <= 1);
    }
  });
});

describe('catalogEntryByKey', () => {
  it('round-trips a search hit back to its full technical sheet', () => {
    const [hit] = searchCatalog({ text: 'seat ibiza' });
    const entry = catalogEntryByKey(hit.key);
    assert.equal(entry.model, hit.model);
    assert.equal(entry.version, hit.version);
    assert.ok('oil' in entry.specs);
  });

  it('is null for a key that does not exist', () => {
    assert.equal(catalogEntryByKey('no-such-car'), null);
    assert.equal(catalogEntryByKey(null), null);
  });
});

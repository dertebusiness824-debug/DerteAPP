import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATEGORY_KEYS,
  INVENTORY_CATEGORIES,
  INVENTORY_PRESET,
  categoryLabel,
  presetItems,
  presetSummary,
} from '../../server/lib/inventory-catalog.js';

describe('inventory categories', () => {
  it('has unique keys and a label for each', () => {
    assert.equal(new Set(CATEGORY_KEYS).size, CATEGORY_KEYS.length);
    for (const category of INVENTORY_CATEGORIES) {
      assert.ok(category.label, `${category.key} has no label`);
    }
  });

  it('labels an unknown category as "Otros" instead of blank', () => {
    assert.equal(categoryLabel('tyres'), 'Neumáticos');
    assert.equal(categoryLabel('nave-espacial'), 'Otros');
    assert.equal(categoryLabel(null), 'Otros');
  });
});

describe('INVENTORY_PRESET', () => {
  it('covers the consumables a workshop actually stocks', () => {
    const names = INVENTORY_PRESET.map((item) => item.name.toLowerCase()).join(' | ');
    assert.match(names, /neumático/);
    assert.match(names, /llanta/);
    assert.match(names, /aceite de motor/);
    assert.match(names, /pastillas de freno/);
    assert.match(names, /batería/);
  });

  it('uses only declared categories', () => {
    for (const item of INVENTORY_PRESET) {
      assert.ok(CATEGORY_KEYS.includes(item.category), `${item.name} is in ${item.category}`);
    }
  });

  it('has no duplicate name + spec pair, which the unique index would reject', () => {
    const keys = INVENTORY_PRESET.map(
      (item) => `${item.name.trim().toLowerCase()}::${(item.spec ?? '').trim().toLowerCase()}`,
    );
    assert.equal(new Set(keys).size, keys.length);
  });

  it('names a unit and a non-negative reorder point for every row', () => {
    for (const item of INVENTORY_PRESET) {
      assert.ok(item.unit, `${item.name} has no unit`);
      assert.ok(item.min_quantity >= 0, `${item.name} has a negative reorder point`);
    }
  });
});

describe('presetItems', () => {
  it('returns the whole preset when no category is chosen', () => {
    assert.equal(presetItems().length, INVENTORY_PRESET.length);
    assert.equal(presetItems(null).length, INVENTORY_PRESET.length);
    assert.equal(presetItems([]).length, INVENTORY_PRESET.length);
  });

  it('filters down to the chosen categories', () => {
    const tyres = presetItems(['tyres']);
    assert.ok(tyres.length > 0);
    assert.ok(tyres.every((item) => item.category === 'tyres'));

    const two = presetItems(['tyres', 'oils']);
    assert.ok(two.length > tyres.length);
    assert.ok(two.every((item) => ['tyres', 'oils'].includes(item.category)));
  });

  it('is empty for a category that does not exist', () => {
    assert.deepEqual(presetItems(['nave-espacial']), []);
  });
});

describe('presetSummary', () => {
  it('counts what the Super Admin is about to load, per category', () => {
    const summary = presetSummary();
    assert.ok(summary.length > 0);
    assert.ok(summary.every((category) => category.count > 0), 'empty categories should be hidden');
    assert.equal(
      summary.reduce((total, category) => total + category.count, 0),
      INVENTORY_PRESET.length,
    );
    for (const category of summary) {
      assert.equal(category.count, presetItems([category.key]).length);
    }
  });
});

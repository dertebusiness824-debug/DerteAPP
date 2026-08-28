import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DIAGNOSTIC_RULES,
  SEVERITIES,
  localDiagnosis,
  stripAccents,
} from '../../server/services/diagnostics.js';

const titles = (result) => result.causes.map((cause) => cause.title);

describe('DIAGNOSTIC_RULES', () => {
  it('has unique ids, so a cause can always be traced back to its rule', () => {
    const ids = DIAGNOSTIC_RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('gives every cause a checklist and a valid severity', () => {
    for (const rule of DIAGNOSTIC_RULES) {
      assert.ok(rule.keywords.length > 0, `${rule.id} has no keywords`);
      assert.ok(rule.causes.length > 0, `${rule.id} has no causes`);
      for (const cause of rule.causes) {
        assert.ok(cause.title, `${rule.id} has a cause with no title`);
        assert.ok(cause.why, `${cause.title} does not say why`);
        assert.ok(cause.checks.length > 0, `${cause.title} has no checks`);
        assert.ok(SEVERITIES.includes(cause.severity), `${cause.title} has severity ${cause.severity}`);
      }
    }
  });

  it('keeps keywords accent-free and lowercase, which is how they are matched', () => {
    for (const rule of DIAGNOSTIC_RULES) {
      for (const keyword of rule.keywords) {
        assert.equal(keyword, stripAccents(keyword), `"${keyword}" would never match`);
      }
    }
  });
});

describe('localDiagnosis', () => {
  it('reads the workshop wording and ranks the usual suspect first', () => {
    const result = localDiagnosis({ prompt: 'El coche no arranca por la mañana' });
    assert.equal(result.provider, 'local');
    assert.ok(result.matched.includes('no-start-crank'));
    assert.match(titles(result)[0], /Batería/);
  });

  it('ignores accents and capitals in the customer description', () => {
    const withAccents = localDiagnosis({ prompt: 'Hace un CHIRRIDO AL FRENAR muy fuerte' });
    const without = localDiagnosis({ prompt: 'hace un chirrido al frenar muy fuerte' });
    assert.deepEqual(titles(withAccents), titles(without));
    assert.ok(withAccents.matched.includes('brake-noise'));
  });

  it('is deterministic: the same consultation always gives the same list', () => {
    const prompt = 'Sale humo blanco por el escape y pierde refrigerante';
    assert.deepEqual(titles(localDiagnosis({ prompt })), titles(localDiagnosis({ prompt })));
  });

  it('drops causes that belong to another fuel type', () => {
    const prompt = 'Da tirones al acelerar';
    const petrol = localDiagnosis({ prompt, vehicle: { fuel: 'Gasolina' } });
    const diesel = localDiagnosis({ prompt, vehicle: { fuel: 'Diésel' } });

    assert.ok(titles(petrol).some((title) => /Bujías/.test(title)));
    assert.equal(
      titles(diesel).some((title) => /Bujías/.test(title)),
      false,
      'spark plugs are not a diesel fault',
    );
  });

  it('keeps fuel-specific causes when no fuel is known', () => {
    const result = localDiagnosis({ prompt: 'Da tirones al acelerar' });
    assert.ok(titles(result).some((title) => /Bujías/.test(title)));
  });

  it('falls back to generic triage rather than inventing a fault', () => {
    const result = localDiagnosis({ prompt: 'El cliente dice que el coche está raro' });
    assert.deepEqual(result.matched, []);
    assert.match(titles(result)[0], /Lectura de códigos/);
    assert.ok(result.causes.every((cause) => cause.rule_id === 'generic'));
  });

  it('reports a likelihood between 1 and 100 for every cause', () => {
    const result = localDiagnosis({ prompt: 'Se calienta el motor y vibra el volante' });
    assert.ok(result.causes.length > 0);
    for (const cause of result.causes) {
      assert.ok(Number.isInteger(cause.likelihood), `${cause.title} likelihood is not an integer`);
      assert.ok(cause.likelihood >= 1 && cause.likelihood <= 100);
    }
  });

  it('merges the causes of every symptom the owner describes at once', () => {
    const result = localDiagnosis({ prompt: 'Se calienta el motor y además pierde agua', limit: 8 });
    assert.ok(result.matched.includes('overheating'));
    assert.ok(result.matched.includes('coolant-leak'));
  });

  it('honours the limit, so the counter is not buried in causes', () => {
    const result = localDiagnosis({ prompt: 'no arranca', limit: 2 });
    assert.equal(result.causes.length, 2);
  });

  it('names no model, because no external model was used', () => {
    assert.equal(localDiagnosis({ prompt: 'no arranca' }).model, null);
  });
});

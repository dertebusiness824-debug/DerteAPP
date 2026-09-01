import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPromiseQueue } from '../../server/lib/promise-queue.js';
import config from '../../server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

describe('database pool defaults', () => {
  it('raises the default pool to 25 and sets a 15s statement timeout', () => {
    assert.equal(config.db.poolMax, 25);
    assert.equal(config.db.statementTimeoutMs, 15_000);
    const db = read('server/db/index.js');
    assert.match(db, /statement_timeout=/);
    assert.match(db, /options: `-c statement_timeout=/);
  });
});

describe('webhook ingest queue', () => {
  it('caps Retell and Cal.com background work at 3–5 concurrent jobs', () => {
    assert.ok(config.webhooks.ingestConcurrency >= 3);
    assert.ok(config.webhooks.ingestConcurrency <= 5);
    const webhooks = read('server/routes/webhooks.js');
    assert.match(webhooks, /createPromiseQueue/);
    assert.match(webhooks, /ingestQueue/);
    assert.doesNotMatch(webhooks, /setImmediate\(\(\) => \{\s*void task;/);
  });

  it('never rate-limits /api/webhooks/*', () => {
    const limiter = read('server/middleware/rate-limit.js');
    assert.match(limiter, /\/webhooks\//);
  });
});

describe('DID routing', () => {
  it('matches shops on generated digit columns instead of regexp_replace', () => {
    const retell = read('server/services/retell.js');
    const telephony = read('server/services/telephony.js');
    const migration = read('server/db/migrations/028_perf_did_trgm.sql');
    assert.match(retell, /retell_did_digits = \$1/);
    assert.match(retell, /zadarma_did_digits = \$1/);
    assert.doesNotMatch(retell, /regexp_replace/);
    assert.match(telephony, /retell_did_digits = \$1/);
    assert.doesNotMatch(telephony, /regexp_replace/);
    assert.match(migration, /pg_trgm/);
    assert.match(migration, /retell_did_digits/);
    assert.match(migration, /gin_trgm_ops/);
  });
});

describe('plate lookup protection', () => {
  it('rate-limits workshop plate identify at 20/min per shop', () => {
    const workshop = read('server/routes/workshop.js');
    const identifyAt = workshop.indexOf("'/vehicles/identify/plate'");
    const slice = workshop.slice(identifyAt, identifyAt + 700);
    assert.match(slice, /rateLimit\(/);
    assert.match(slice, /name: 'plate-lookup'/);
    assert.match(slice, /limit: 20/);
    assert.match(slice, /req\.shop\?\.id/);
  });

  it('locks in-flight official lookups and skips the audit row', () => {
    const apivehiculo = read('server/services/apivehiculo.js');
    const vehicles = read('server/services/vehicles.js');
    assert.match(apivehiculo, /lookup_in_progress/);
    assert.match(apivehiculo, /inflightLookups/);
    assert.match(vehicles, /lookup_in_progress/);
  });
});

describe('PWA pagination and SSE', () => {
  it('pages inventory and caps telephony at 100 rows', () => {
    const inventory = read('server/services/inventory.js');
    const inventoryView = read('public/js/views/inventory.js');
    const telephonyView = read('public/js/views/telephony.js');
    const telephonyRoutes = read('server/routes/telephony.js');
    assert.match(inventory, /LIMIT \$5 OFFSET \$6/);
    assert.match(inventory, /has_more/);
    assert.match(inventoryView, /PAGE_SIZE = 50/);
    assert.match(inventoryView, /data-inv-more/);
    assert.match(telephonyView, /limit: 100/);
    assert.doesNotMatch(telephonyView, /limit: 500/);
    assert.match(telephonyRoutes, /default\(100\)/);
  });

  it('does not open a second /chat/stream from Home', () => {
    const home = read('public/js/views/home.js');
    const cache = read('public/js/data-cache.js');
    assert.doesNotMatch(home, /stream\(`\/chat\/stream/);
    assert.match(home, /subscribeShopLiveEvents/);
    assert.match(cache, /subscribeShopLiveEvents/);
    assert.match(cache, /\/chat\/stream\?shop_id=/);
  });
});

describe('createPromiseQueue', () => {
  it('never runs more jobs than the concurrency cap', async () => {
    const enqueue = createPromiseQueue({ concurrency: 4 });
    let current = 0;
    let peak = 0;
    const jobs = Array.from({ length: 12 }, () =>
      enqueue(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise((resolve) => setTimeout(resolve, 20));
        current -= 1;
      }),
    );
    await Promise.all(jobs);
    assert.equal(peak, 4);
    assert.equal(enqueue.active(), 0);
    assert.equal(enqueue.pending(), 0);
  });

  it('flush waits until the queue is empty', async () => {
    const enqueue = createPromiseQueue({ concurrency: 2 });
    let done = 0;
    enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      done += 1;
    });
    enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      done += 1;
    });
    await enqueue.flush();
    assert.equal(done, 2);
  });
});

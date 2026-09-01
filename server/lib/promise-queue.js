/**
 * Tiny in-process promise queue with a hard concurrency cap.
 *
 * Used so Retell / Cal.com webhook ingest cannot stampede the Postgres pool
 * during a burst of call_analyzed events. No extra npm dependency — same
 * spirit as the in-memory rate limiter.
 */
export function createPromiseQueue({ concurrency = 4 } = {}) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const waiting = [];
  const running = new Set();
  let active = 0;

  const pump = () => {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active += 1;
      const run = Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          running.delete(run);
          active -= 1;
          pump();
        });
      running.add(run);
    }
  };

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      pump();
    });
  }

  enqueue.pending = () => waiting.length;
  enqueue.active = () => active;
  enqueue.size = () => waiting.length + active;

  enqueue.flush = async () => {
    while (waiting.length || running.size) {
      if (running.size) await Promise.allSettled([...running]);
      else await new Promise((resolve) => setImmediate(resolve));
    }
  };

  enqueue.enqueue = enqueue;
  return enqueue;
}

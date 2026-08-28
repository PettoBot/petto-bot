/** Runs an async worker over an iterable with a fixed number of workers. */
async function forEachWithConcurrency(iterable, worker, requestedConcurrency = 4) {
  const iterator = iterable[Symbol.iterator]();
  const concurrency = Math.max(1, Math.min(32, Number(requestedConcurrency) || 1));

  async function consume() {
    while (true) {
      const next = iterator.next();
      if (next.done) return;
      await worker(next.value);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => consume()));
}

/** Prevents interval jobs from starting a second run while the first is still active. */
function exclusiveTask(task) {
  let inFlight = null;

  return (...args) => {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => task(...args))
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

module.exports = { forEachWithConcurrency, exclusiveTask };

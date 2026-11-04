// i18n-ignore-file: internal request pacing (no text for members).
// The queue in front of every request Petto makes to Discord. The host closes an app that passes 300 requests in 30 seconds, so the bot paces
// itself (`restRequestsPerSecond`, 8 by default) with a bucket of tokens: it refills `perSecond` tokens a second and a request takes one.
//
// What the old limit did wrong: it was one line for everybody. A command (`/mod mute`, `!purge`, even `!ping`) waited behind the background
// work of every server (logs, stickies, feeds, timers), and when more than the limit arrived in a second the waiting ones were counted again
// each second, so a request could wait several seconds for nothing. Here there are two lanes:
//   - `high`: what a person is waiting for (the answer to a command or a button, interaction callbacks). It never waits for the background lane;
//     it only waits when the bucket is `debtFactor` seconds in debt, which is what keeps the host limit (the bucket plus the debt is at most
//     `perSecond * (30 + 1 + debtFactor)` requests in 30 seconds, under 300 for the default).
//   - `normal`: everything else, first come first served, paced at `perSecond`, and bounded: no more than `maxQueue` wait, no more than `maxInFlight`
//     are out at once, and a request that waited `failFastMs` fails (a log, a timer, a rename that Discord would refuse) instead of sitting in the line.
// A request with an AbortSignal leaves the line when the signal fires.
const { performance } = require('node:perf_hooks');

class RestGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RestGateError';
    this.code = code;
  }
}

function createGate({
  perSecond = 8, capacity = perSecond, debtFactor = 3, maxQueue = 400, failFastMs = 30_000, maxInFlight = 40,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const rate = Math.max(0.1, Number(perSecond) || 8) / 1000; // tokens per millisecond
  const cap = Math.max(1, Number(capacity) || perSecond);
  const debtCap = Math.max(0, debtFactor * perSecond);
  let tokens = cap;
  let last = now();
  let timer = null;
  let inFlight = 0;
  const high = [];
  const normal = [];
  const served = { high: 0, normal: 0 };
  const failed = { full: 0, wait: 0, aborted: 0 };

  const refill = () => {
    const current = now();
    tokens = Math.min(cap, tokens + (current - last) * rate);
    last = current;
  };
  const canHigh = () => tokens - 1 >= -debtCap;
  const canNormal = () => tokens >= 1 && inFlight < maxInFlight;

  function take(lane) {
    tokens -= 1;
    inFlight += 1;
    served[lane] += 1;
  }

  function settle(waiter, error) {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    if (error) waiter.reject(error); else waiter.resolve(now() - waiter.at);
  }

  function pump() {
    timer = null;
    refill();
    const current = now();
    // A background request that waited too long fails: it is better for a log or a timer to be lost than to sit in the line for minutes.
    while (normal.length && current - normal[0].at > failFastMs) {
      failed.wait += 1;
      settle(normal.shift(), new RestGateError('PETTO_REST_WAIT_TIMEOUT', `A background request to Discord waited more than ${Math.round(failFastMs / 1000)} s in the queue and was dropped.`)); // i18n-ignore: internal
    }
    while (high.length && canHigh()) { const waiter = high.shift(); take('high'); settle(waiter); }
    while (normal.length && !high.length && canNormal()) { const waiter = normal.shift(); take('normal'); settle(waiter); }
    schedule();
  }

  function schedule() {
    if (timer || (!high.length && !normal.length)) return;
    let wait = Infinity;
    if (high.length) wait = Math.min(wait, (1 - debtCap - tokens) / rate);
    if (normal.length) {
      if (!high.length) wait = Math.min(wait, tokens < 1 ? (1 - tokens) / rate : 50); // 50 ms: waiting for a request in flight to finish (done() pumps too)
      wait = Math.min(wait, Math.max(1, failFastMs - (now() - normal[0].at) + 1));
    }
    if (!Number.isFinite(wait)) wait = 100;
    timer = setTimer(pump, Math.max(1, Math.ceil(wait)));
  }

  return {
    /** Resolves with the milliseconds waited when the request may go (and `done()` must be called when it ends), or rejects with a RestGateError. */
    acquire(priority = 'normal', { signal = null } = {}) {
      if (signal?.aborted) { failed.aborted += 1; return Promise.reject(signal.reason ?? new RestGateError('PETTO_REST_ABORTED', 'The request was cancelled.')); } // i18n-ignore: internal
      refill();
      const lane = priority === 'high' ? high : normal;
      if (!high.length && !normal.length) {
        if (priority === 'high' ? canHigh() : canNormal()) { take(priority === 'high' ? 'high' : 'normal'); return Promise.resolve(0); }
      } else if (priority === 'high' && !high.length && canHigh()) {
        take('high'); return Promise.resolve(0); // answers do not queue behind the background lane
      }
      if (priority !== 'high' && normal.length >= maxQueue) {
        failed.full += 1;
        return Promise.reject(new RestGateError('PETTO_REST_QUEUE_FULL', `More than ${maxQueue} background requests to Discord are waiting: this one was dropped.`)); // i18n-ignore: internal
      }
      return new Promise((resolve, reject) => {
        const waiter = { at: now(), resolve, reject, signal, onAbort: null };
        if (signal) {
          waiter.onAbort = () => {
            const index = lane.indexOf(waiter);
            if (index >= 0) lane.splice(index, 1);
            failed.aborted += 1;
            reject(signal.reason ?? new RestGateError('PETTO_REST_ABORTED', 'The request was cancelled.')); // i18n-ignore: internal
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }
        lane.push(waiter);
        schedule();
      });
    },
    /** A request that got its place has ended. */
    done() {
      inFlight = Math.max(0, inFlight - 1);
      if (normal.length || high.length) { if (timer) { clearTimer(timer); timer = null; } pump(); }
    },
    stats() {
      refill();
      const current = now();
      return { perSecond: rate * 1000, tokens: Math.round(tokens * 10) / 10, inFlight, maxInFlight, maxQueue, failFastMs, queuedHigh: high.length, queuedNormal: normal.length, oldestNormalMs: normal.length ? Math.round(current - normal[0].at) : 0, served: { ...served }, failed: { ...failed } };
    },
    /** For the checks. */
    stop() { if (timer) clearTimer(timer); timer = null; },
  };
}

module.exports = { createGate, RestGateError };

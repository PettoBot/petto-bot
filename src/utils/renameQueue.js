// One small line for every counter edit Petto sends to Discord (a channel name, a category name, a topic). The budget of each channel
// (two edits every ten minutes, see counterNames.js) says when a channel may change; this line says how fast the bot as a whole sends
// them: many counters changing at once (a raid in a big server, the clocks of every server at the same minute, a restart) go out one
// after another with a short, slightly random gap between any two, and a longer one between two of the same server, instead of all at
// once against Discord's global and per-route limits.
//
// A channel is in the line at most once: asking again while it waits merges into that place (its edit reads the value of the moment it
// goes out), and everyone who asked gets the same result. Nothing here is kept across a restart: the full pass after a start puts back
// what is still needed, and the budget itself is saved with each counter.

const DEFAULTS = { gapMs: 300, guildGapMs: 2_500, jitterMs: 400, concurrency: 2 };

function createRenameQueue(options = {}) {
  const settings = { ...DEFAULTS };
  let now = options.now ?? (() => Date.now());
  let random = options.random ?? Math.random;
  let setTimer = options.setTimer ?? ((fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; });
  let clearTimer = options.clearTimer ?? clearTimeout;
  const items = new Map(); // key -> { key, guildId, run, waiters, addedAt }
  const guildNext = new Map(); // guild id -> the earliest moment its next edit may go
  let nextAt = 0;
  let running = 0;
  let wake = null; // { timer, at }
  const sent = []; // the moments of the last edits sent, for the dashboard and the checks

  function configure(next = {}) {
    for (const key of Object.keys(DEFAULTS)) if (next[key] !== undefined) settings[key] = Math.max(0, Number(next[key]) || 0);
    if (next.now) now = next.now;
    if (next.random) random = next.random;
    if (next.setTimer) setTimer = next.setTimer;
    if (next.clearTimer) clearTimer = next.clearTimer;
    if (settings.concurrency < 1) settings.concurrency = 1;
  }
  configure(options);

  const spread = (ms) => ms + Math.floor(random() * settings.jitterMs);

  function sleepUntil(at) {
    if (wake && wake.at <= at) return;
    if (wake) clearTimer(wake.timer);
    const timer = setTimer(() => { wake = null; pump(); }, Math.max(0, at - now()));
    wake = { timer, at };
  }

  function pump() {
    while (running < settings.concurrency && items.size) {
      const t = now();
      if (t < nextAt) { sleepUntil(nextAt); return; }
      let pick = null;
      let soonest = Infinity;
      for (const item of items.values()) {
        const ready = guildNext.get(item.guildId) ?? 0;
        if (ready <= t) { pick = item; break; }
        soonest = Math.min(soonest, ready);
      }
      if (!pick) { sleepUntil(soonest); return; }
      items.delete(pick.key);
      running += 1;
      nextAt = t + spread(settings.gapMs);
      guildNext.set(pick.guildId, t + spread(settings.guildGapMs));
      sent.push(t);
      if (sent.length > 200) sent.splice(0, sent.length - 200);
      Promise.resolve()
        .then(() => pick.run())
        .then((value) => { for (const waiter of pick.waiters) waiter.resolve(value); }, (error) => { for (const waiter of pick.waiters) waiter.reject(error); })
        .finally(() => { running -= 1; pump(); });
    }
    // Forget the servers whose gap is over, so the map does not grow with every server ever seen.
    if (!items.size && guildNext.size > 1000) { const t = now(); for (const [id, at] of guildNext) if (at <= t) guildNext.delete(id); }
  }

  /** Puts an edit in the line (or merges it into the one of the same key already waiting). Resolves with what `run` returns. */
  function push(key, guildId, run) {
    return new Promise((resolve, reject) => {
      const waiting = items.get(key);
      if (waiting) { waiting.run = run; waiting.waiters.push({ resolve, reject }); return; }
      items.set(key, { key, guildId: String(guildId ?? ''), run, waiters: [{ resolve, reject }], addedAt: now() });
      pump();
    });
  }

  /** When an edit waiting in the line was put there, or null. */
  function queuedAt(key) {
    return items.get(key)?.addedAt ?? null;
  }

  function clear() {
    if (wake) clearTimer(wake.timer);
    wake = null;
    for (const item of items.values()) for (const waiter of item.waiters) waiter.resolve(null);
    items.clear();
    guildNext.clear();
    nextAt = 0;
  }

  return { push, queuedAt, configure, clear, size: () => items.size, running: () => running, sent: () => [...sent], settings: () => ({ ...settings }) };
}

module.exports = { createRenameQueue, DEFAULTS };

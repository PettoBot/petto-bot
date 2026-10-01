/**
 * Races a promise against a timer so a slow dependency (usually the database) cannot hold a command past
 * Discord's three second acknowledgement window. The original promise keeps running; its result is dropped
 * if the timer wins.
 */
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Resolves to `{ ok: true, value }` or `{ ok: false, error }` instead of throwing, for allSettled-style steps. */
async function settle(promise, ms = null, label = 'operation') {
  try {
    return { ok: true, value: ms ? await withTimeout(promise, ms, label) : await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

module.exports = { withTimeout, settle };

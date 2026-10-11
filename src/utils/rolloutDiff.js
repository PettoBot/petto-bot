// What changed between what was true of each experiment last time and the list now: a new one, a rollout that grew or shrank,
// or a new status. The first time there is nothing to compare with, so that pass only remembers (see rolloutAlerts).
const round = (value) => Math.round(value * 100) / 100;

/** What is kept of an experiment to compare it later. */
function snapshotOf(rollout) {
  const { id, ...rest } = rollout;
  void id;
  return rest;
}

/** The change in percentage points between two snapshots, or 0 when either has no percentage to compare. */
function changeBetween(before, after) {
  if (after.percent == null && before.percent == null) return 0;
  return round((after.percent ?? 0) - (before.percent ?? 0));
}

/**
 * The events of one pass, oldest data first: `new`, `status`, `increase` or `decrease`, each with the experiment, what it was
 * before (null for a new one) and the change in percentage points. An experiment gives at most one event per pass.
 */
function diffRollouts(previous, list) {
  const events = [];
  for (const rollout of list) {
    const before = previous.get(rollout.id);
    if (!before) { events.push({ type: 'new', rollout, before: null, change: rollout.percent ?? 0 }); continue; }
    const change = changeBetween(before, rollout);
    if ((before.status ?? null) !== (rollout.status ?? null)) events.push({ type: 'status', rollout, before, change });
    else if (Math.abs(change) >= 0.01) events.push({ type: change > 0 ? 'increase' : 'decrease', rollout, before, change });
  }
  return events;
}

/** Whether a server wants an event, by its filters. Empty lists let everything through. */
function matchesEvent(event, config) {
  const { rollout, type, change } = event;
  if (config.kinds?.length && !config.kinds.includes(rollout.kind)) return false;
  if (config.events?.length && !config.events.includes(type)) return false;
  if ((type === 'increase' || type === 'decrease') && Math.abs(change) < (Number(config.min_change) || 0)) return false;
  if (type === 'new' && !config.include_unrolled && (!rollout.status || rollout.status === 'not_rolled_out')) return false;
  return true;
}

module.exports = { snapshotOf, changeBetween, diffRollouts, matchesEvent };

// i18n-ignore-file: routing of the error log for the Petto team.
// Every error and warning of the logger arrives here and goes to one of two channels. The GENERAL log gets the warnings and the errors that are
// expected (a button pressed after its 3 seconds, a deleted channel, a rate limit, a network or Redis hiccup): they never ping anybody. The PRIORITY
// log gets every other error, for the team to investigate (see errorTriage.js and priorityErrorLog.js).
const { classify, findError } = require('./errorTriage');

const KEEP_LINES = 40;
const LINE_MAX = 160;
const RECENT_WINDOW_MS = 5 * 60_000;
const NOT_EXPLAINED = new Set(['unexpected-error', 'unexpected-message', 'unknown', 'code-bug', 'unknown-api-code']);

function lineOf(level, args, stamp) {
  const text = args.map((arg) => (arg instanceof Error || (arg && typeof arg.message === 'string') ? arg.message : typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch { return ''; } })())).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const time = String(stamp ?? new Date().toISOString()).slice(11, 19);
  return `[${time}] ${level.toUpperCase()} ${text}`.slice(0, LINE_MAX);
}

/**
 * `general(level, args, stamp, context)` and `priority(level, args, stamp, context, triage, { recent })` are the two sinks. Returns the sink for the
 * logger. A warning always goes to the general log; an error goes to the priority log unless the triage says it is expected, in which case it
 * goes to the general log as a warning, with what it means.
 */
function createErrorRouter({ general, priority, now = () => Date.now() }) {
  const lines = []; // what went to the general log lately, to give the team the context of a priority error

  function remember(level, args, stamp) {
    lines.push({ at: now(), line: lineOf(level, args, stamp) });
    if (lines.length > KEEP_LINES) lines.shift();
  }

  return async (level, args, stamp, context) => {
    if (level === 'info') return undefined;
    const error = findError(args);
    const triage = classify(error, { args, level, internal: context?.internal, exhausted: context?.exhausted });
    if (level === 'error' && triage.priority) {
      const at = now();
      const recent = lines.filter((entry) => at - entry.at <= RECENT_WINDOW_MS).slice(-5).map((entry) => entry.line);
      return priority('error', args, stamp, context, triage, { recent });
    }
    remember('warn', args, stamp);
    // An expected error is a warning here; what it means is said in the card so nobody has to look it up.
    return general('warn', args, stamp, { ...(context ?? {}), triaged: level === 'error', explanation: NOT_EXPLAINED.has(triage.kind) ? null : triage.explanation });
  };
}

module.exports = { createErrorRouter };

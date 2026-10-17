// Milestone announcements: a message in a channel when the server reaches the goal of a goal counter, or every N members (every 100,
// every 1,000...). The last number announced is saved before the message goes out, so the same number is never announced twice, also
// after a restart or when members leave and join again around it.
const { nextGoal, formatCount } = require('./counterNames');
const { t, currentLanguage } = require('../i18n');

// Loaded when a message goes out: they reach for the database, which the checks do without.
const templatePayload = (...args) => require('./templatedMessage').templatePayload(...args);

const MAX_TEXT = 2000;
const MAX_EVERY = 100_000_000;

/**
 * The member number to announce now, or null. `last` is the last one announced (null: nothing yet, the count of now is the start and
 * nothing is announced). With `every` the multiples of it count; with `goals` (the goal counters' rows) the goals they show. When
 * several were passed at once (a raid of joins) only the highest is announced.
 */
function milestoneToAnnounce({ count, last, every = null, goalRows = [], useGoals = true }) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (last === null || last === undefined || !Number.isFinite(Number(last))) return { start: n };
  const from = Math.trunc(Number(last));
  if (n <= from) return null;
  let best = null;
  const step = Math.trunc(Number(every) || 0);
  if (step > 0) {
    const multiple = Math.floor(n / step) * step;
    if (multiple > from && multiple > 0) best = multiple;
  }
  if (useGoals) {
    for (const row of goalRows ?? []) {
      if (row.counter_option !== 'goal' || row.enabled === false) continue;
      // Walk the goals this counter would show from the last number on, and keep the highest one reached.
      let goal = nextGoal(from, row.goal);
      let reached = null;
      for (let i = 0; i < 64 && goal <= n; i += 1) { reached = goal; goal = nextGoal(goal, row.goal); }
      if (reached !== null && (best === null || reached > best)) best = reached;
    }
  }
  return best === null ? null : { milestone: best };
}

/** The next member number that would be announced (for the status and the dashboard), or null when nothing is set to be announced. */
function nextMilestone({ count, last = null, every = null, goalRows = [], useGoals = true }) {
  const base = Math.max(Math.trunc(Number(count) || 0), Number.isFinite(Number(last)) && last !== null ? Math.trunc(Number(last)) : 0);
  const candidates = [];
  const step = Math.trunc(Number(every) || 0);
  if (step > 0) candidates.push((Math.floor(base / step) + 1) * step);
  if (useGoals) for (const row of goalRows ?? []) if (row.counter_option === 'goal' && row.enabled !== false) candidates.push(nextGoal(base, row.goal));
  return candidates.length ? Math.min(...candidates) : null;
}

/** Reads `every`: a whole number from 1 up, or null for `off`. Returns undefined when it is not valid. */
function parseEvery(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || ['off', 'none', 'no', '0', '-', 'never'].includes(text)) return null;
  const n = Math.trunc(Number(text.replace(/[.,_\s]/g, '')));
  if (!Number.isFinite(n) || n < 1 || n > MAX_EVERY) return undefined;
  return n;
}

/** The variables of an announcement text. `{count}` the members now, `{goal}` (and `{milestone}`) the number reached, `{server}` its name. */
function announceVars(guild, { count, milestone }, lang = currentLanguage()) {
  const grouped = (n) => formatCount(n, 'grouped', lang);
  return {
    '{count}': grouped(count), '{goal}': grouped(milestone), '{milestone}': grouped(milestone), '{server}': guild?.name ?? '',
    '{counter.count}': grouped(count), '{counter.goal}': grouped(milestone), '{counter.server}': guild?.name ?? '',
  };
}

function renderAnnounceText(template, vars) {
  return String(template ?? '').replace(/\{(?:counter\.)?(?:count|goal|milestone|server)\}/g, (whole) => vars[whole] ?? whole).slice(0, MAX_TEXT);
}

/** The message of an announcement: the saved embed when one is chosen and it can be built, otherwise the text (or the default text). */
async function announcePayload(guild, channel, config, numbers, lang = currentLanguage()) {
  const vars = announceVars(guild, numbers, lang);
  if (config.embed_name) {
    const payload = await templatePayload(guild.id, config.embed_name, {
      guild, channel, lang, counter: { count: vars['{count}'], goal: vars['{goal}'], server: vars['{server}'] },
    }).catch(() => null);
    if (payload) {
      const { reactions, ...message } = payload;
      return { ...message, allowedMentions: { parse: [] } };
    }
  }
  const text = renderAnnounceText(String(config.message ?? '').trim() || t(lang, 'counters.announce.default'), vars);
  return { content: text, allowedMentions: { parse: [] } };
}

/** The channel an announcement goes to, when Petto can write there. */
function announceChannel(guild, config) {
  const channel = config?.channel_id ? guild.channels?.cache?.get(config.channel_id) : null;
  if (!channel || typeof channel.send !== 'function') return null;
  const me = guild.members?.me;
  if (me && typeof channel.permissionsFor === 'function') {
    const perms = channel.permissionsFor(me);
    if (perms && typeof perms.has === 'function' && !(perms.has('ViewChannel') && perms.has('SendMessages'))) return null;
  }
  return channel;
}

module.exports = { milestoneToAnnounce, nextMilestone, parseEvery, announceVars, renderAnnounceText, announcePayload, announceChannel, MAX_TEXT };

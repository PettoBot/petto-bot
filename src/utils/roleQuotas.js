// Role quotas: a member who holds a role with a quota must send at least `min_messages` messages in each period of `period_days` days; after `max_strikes`
// periods in a row below it, the role is taken away. Everything that decides is plain functions here (the validation of a rule, who is judged and how, the
// strikes), so it is checked without Discord; `noteMessage` counts, and `runDueRules` closes the periods (jobs/roleQuotaJob.js calls it).
// Only a number per member and period is kept, never what was said, and only for members who hold a role with a quota.
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const quotasDb = require('../db/roleQuotas');
const { textCard } = require('./caseCard');
const { sendDm } = require('./dmOrigin');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

const MAX_RULES = 25;
const MAX_PERIOD_DAYS = 90;
const MAX_MESSAGES = 100_000;
const MAX_STRIKES = 20;
const MAX_EXCUSE_DAYS = 90;
const MAX_CHANNELS = 25;
const MAX_REMIND_HOURS = 72;
const CHANNEL_MODES = ['all', 'only', 'except'];
const DAY_MS = 86_400_000;
const FLUSH_MS = 10_000;
const DM_LIMIT = 100; // notices by direct message in one period closing of one rule; the report says how many were left out
const DM_GAP_MS = 1_000;

// ---- Rules -----------------------------------------------------------------------------------------------------------------------

/**
 * Validates what `set` was given. `role` has `id` and `managed`, `guildId` is the server, `existingRoleIds` are the roles that already have a quota.
 * Returns `{ ok: true, rule }` or `{ ok: false, error }` (the last part of `automation.rolequota.error.<error>`).
 */
function validateRule({ role, guildId, messages, periodDays = 7, strikes = 3, notifyDm = true, reportChannelId = null, channelMode = 'all', channelIds = [], remindHours = 0, existingRoleIds = [] }) {
  if (!role) return { ok: false, error: 'noRole' };
  if (role.id === guildId) return { ok: false, error: 'everyone' };
  if (role.managed) return { ok: false, error: 'managed' };
  const min = Number(messages);
  if (!Number.isInteger(min) || min < 1 || min > MAX_MESSAGES) return { ok: false, error: 'badMessages' };
  const days = Number(periodDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_PERIOD_DAYS) return { ok: false, error: 'badPeriod' };
  const max = Number(strikes);
  if (!Number.isInteger(max) || max < 1 || max > MAX_STRIKES) return { ok: false, error: 'badStrikes' };
  if (!existingRoleIds.includes(role.id) && existingRoleIds.length >= MAX_RULES) return { ok: false, error: 'tooMany' };
  const channel = reportChannelId ? String(reportChannelId) : null;
  if (channel && !/^\d{15,25}$/.test(channel)) return { ok: false, error: 'badChannel' };
  const where = validateChannels(channelMode, channelIds);
  if (!where.ok) return where;
  const remind = Number(remindHours);
  if (!Number.isInteger(remind) || remind < 0 || remind > MAX_REMIND_HOURS) return { ok: false, error: 'badRemind' };
  return { ok: true, rule: { roleId: role.id, periodDays: days, minMessages: min, maxStrikes: max, notifyDm: Boolean(notifyDm), reportChannelId: channel, channelMode: where.mode, channelIds: where.ids, remindHours: remind } };
}

/** The mode and the channels of a rule, checked: `all` has none, `only` needs at least one, and at most 25 ids. Returns `{ ok, mode, ids }` or `{ ok: false, error }`. */
function validateChannels(mode = 'all', ids = []) {
  if (!CHANNEL_MODES.includes(mode)) return { ok: false, error: 'badChannelMode' };
  const list = [...new Set((ids ?? []).map(String))];
  if (list.some((id) => !/^\d{15,25}$/.test(id))) return { ok: false, error: 'badChannel' };
  if (list.length > MAX_CHANNELS) return { ok: false, error: 'tooManyChannels' };
  if (mode === 'only' && !list.length) return { ok: false, error: 'noChannels' };
  return { ok: true, mode, ids: mode === 'all' ? [] : list };
}

/**
 * Whether a message in this channel counts for the rule. `all` counts every channel; `only` the listed ones; `except` every one but the listed. A listed id can be the
 * channel, its category, or (for a thread) the channel it is in or that channel's category.
 */
function countsIn(rule, channel) {
  const mode = rule.channel_mode ?? 'all';
  if (mode === 'all') return true;
  const ids = new Set((rule.channel_ids ?? []).map(String));
  if (!ids.size) return mode === 'except';
  const places = [channel?.id, channel?.parentId, channel?.parent?.parentId].filter(Boolean).map(String);
  const listed = places.some((id) => ids.has(id));
  return mode === 'only' ? listed : !listed;
}

// ---- Judging ---------------------------------------------------------------------------------------------------------------------

/**
 * What one member's period was. `row` is their count (`messages`, `strikes`, `since`, `excused_until`; none when Petto has nothing about them), `periodStart` is when the
 * period began and `now` when it is being closed. Answers 'excused' (they asked for time off: nothing counts), 'new' (they were given the role during the period: judged
 * from the next one), 'met' or 'missed'.
 */
function judge(row, rule, periodStart, now = Date.now()) {
  const excused = row?.excused_until ? new Date(row.excused_until).getTime() : 0;
  if (excused > now) return 'excused';
  const since = row?.since ? new Date(row.since).getTime() : 0;
  if (since > new Date(periodStart).getTime()) return 'new';
  return Number(row?.messages ?? 0) >= rule.min_messages ? 'met' : 'missed';
}

/** The strikes after a result, and whether the role goes: a period met clears them, a missed one adds one, a 'new' or 'excused' one leaves them as they were. */
function applyResult(strikes, result, maxStrikes) {
  const before = Math.max(0, Number(strikes) || 0);
  if (result === 'met') return { strikes: 0, remove: false };
  if (result !== 'missed') return { strikes: before, remove: false };
  const next = before + 1;
  return { strikes: next, remove: next >= maxStrikes };
}

// ---- Counting --------------------------------------------------------------------------------------------------------------------

const pending = new Map(); // `${guild}|${role}|${user}` -> messages not saved yet
let flushTimer = null;

async function flush() {
  flushTimer = null;
  if (!pending.size) return;
  const taken = [...pending.entries()];
  pending.clear();
  const entries = taken.map(([key, count]) => { const [guildId, roleId, userId] = key.split('|'); return { guildId, roleId, userId, count }; });
  try {
    await quotasDb.addMessages(entries);
  } catch (err) {
    // Not lost for good: they go back to be saved with the next ones (up to a limit, so a database that stays down does not fill the memory).
    logger.warn(`Role quotas: could not save ${entries.length} message count(s): ${err.message}`);
    if (pending.size < 5_000) for (const entry of entries) pending.set(`${entry.guildId}|${entry.roleId}|${entry.userId}`, (pending.get(`${entry.guildId}|${entry.roleId}|${entry.userId}`) ?? 0) + entry.count);
  }
}

/** Counts a message for each role with a quota that its author holds. Memory only: one statement saves them all every few seconds. */
async function noteMessage(message) {
  if (!message.guild || message.author?.bot || message.webhookId || !message.member) return;
  const rules = await quotasDb.listRules(message.guild.id);
  if (!rules.length) return;
  for (const rule of rules) {
    if (!message.member.roles.cache.has(rule.role_id) || !countsIn(rule, message.channel)) continue;
    const key = `${message.guild.id}|${rule.role_id}|${message.author.id}`;
    pending.set(key, (pending.get(key) ?? 0) + 1);
  }
  if (!flushTimer) { flushTimer = setTimeout(() => { flush().catch(() => {}); }, FLUSH_MS); flushTimer.unref?.(); }
}

/** A role was given or taken away: the new holder is judged from the next period; the one who lost it is forgotten. */
async function handleMemberUpdate(oldMember, newMember) {
  if (!newMember?.guild || newMember.user?.bot) return;
  const before = oldMember?.roles?.cache;
  if (!before) return; // the member was not in the cache: what changed is not known
  const rules = await quotasDb.listRules(newMember.guild.id);
  for (const rule of rules) {
    const had = before.has(rule.role_id);
    const has = newMember.roles.cache.has(rule.role_id);
    if (!had && has) await quotasDb.markNewHolder(newMember.guild.id, rule.role_id, newMember.id);
    else if (had && !has) await quotasDb.forgetHolder(newMember.guild.id, rule.role_id, newMember.id);
  }
}

// ---- Closing a period ------------------------------------------------------------------------------------------------------------

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mentionList(ids, max = 20) {
  const shown = ids.slice(0, max).map((id) => `<@${id}>`).join(' ');
  return ids.length > max ? `${shown} +${ids.length - max}` : shown;
}

/**
 * Closes the period of one rule: judges each member who holds the role, takes the role away from who reached the strikes, tells them and the report channel, and
 * starts the next period. Returns `{ met, missed, removed, failed, excused, fresh }` or null when the server or the role cannot be reached now (it is tried again).
 */
async function closeRule(client, rule, { now = new Date(), sleep = wait } = {}) {
  const guild = client.guilds.cache.get(rule.guild_id);
  if (!guild) return null;
  const lang = await guildLanguage(guild.id);
  const role = guild.roles.cache.get(rule.role_id);
  if (!role) {
    // The role is gone: there is nobody to judge. The rule stays (the dashboard shows it without a name) and the next period starts.
    await quotasDb.closePeriod(rule, { now });
    return { met: 0, missed: 0, removed: 0, failed: 0, excused: 0, fresh: 0 };
  }
  await guild.members.fetch().catch(() => null);
  const holders = [...role.members.values()].filter((member) => !member.user.bot);
  if (!holders.length && guild.memberCount > 1 && guild.members.cache.size <= 1) return null; // the members could not be read: nobody is judged on that
  const rows = new Map((await quotasDb.listMembers(guild.id, rule.role_id)).map((row) => [row.user_id, row]));
  const periodStart = rule.period_started_at;
  const result = { met: 0, missed: 0, removed: 0, failed: 0, excused: 0, fresh: 0 };
  const saved = [];
  const removedIds = [];
  const missedIds = [];
  const failedIds = [];
  const toTell = [];
  const me = guild.members.me;
  const canRemove = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles)) && me.roles.highest.comparePositionTo(role) > 0;

  for (const member of holders) {
    const row = rows.get(member.id) ?? null;
    const verdict = judge(row, rule, periodStart, now.getTime());
    const decided = applyResult(row?.strikes, verdict, rule.max_strikes);
    let strikes = decided.strikes;
    if (verdict === 'excused') result.excused += 1;
    else if (verdict === 'new') result.fresh += 1;
    else if (verdict === 'met') result.met += 1;
    else {
      result.missed += 1;
      missedIds.push(member.id);
    }
    let finalResult = verdict;
    if (decided.remove) {
      const removed = canRemove && await member.roles.remove(role, t(lang, 'automation.rolequota.reason.removed', { messages: row?.messages ?? 0, min: rule.min_messages })).then(() => true).catch(() => false);
      if (removed) {
        result.removed += 1;
        removedIds.push(member.id);
        toTell.push({ member, kind: 'removed', messages: row?.messages ?? 0, strikes: decided.strikes });
        // The role is gone: nothing is kept for this member (if they get it back they start clean, from the next period).
        continue;
      }
      // The role could not be taken away (Petto is below it or lacks the permission): the strikes stay at the limit so the next period tries again.
      result.failed += 1;
      failedIds.push(member.id);
      strikes = rule.max_strikes;
    } else if (verdict === 'missed') {
      toTell.push({ member, kind: 'missed', messages: row?.messages ?? 0, strikes });
    }
    saved.push({ userId: member.id, strikes, lastResult: finalResult });
  }

  await quotasDb.saveResults(guild.id, rule.role_id, saved);
  // Members who do not hold the role any more (or whom Petto lost sight of) are forgotten, with their count.
  const holderIds = new Set(holders.map((member) => member.id));
  await quotasDb.forgetMembers(guild.id, rule.role_id, [...rows.keys()].filter((id) => !holderIds.has(id) || removedIds.includes(id)));
  await quotasDb.closePeriod(rule, { now, met: result.met, missed: result.missed, removed: result.removed });

  let sentDms = 0;
  if (rule.notify_dm) {
    for (const entry of toTell) {
      if (sentDms >= DM_LIMIT) break;
      const text = t(lang, entry.kind === 'removed' ? 'automation.rolequota.dm.removed' : 'automation.rolequota.dm.missed', {
        emoji: entry.kind === 'removed' ? EMOJI.ALERT : EMOJI.DENY, server: guild.name, role: role.name, messages: entry.messages, min: rule.min_messages, strikes: entry.strikes, max: rule.max_strikes, days: rule.period_days,
      });
      await sendDm(entry.member, { components: [textCard(text, entry.kind === 'removed' ? 0xfe6465 : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 }, { guild, kind: 'rolequota' }).catch(() => {});
      sentDms += 1;
      await sleep(DM_GAP_MS);
    }
  }

  if (rule.report_channel_id) {
    const channel = guild.channels.cache.get(rule.report_channel_id);
    if (channel?.isTextBased?.()) {
      const lines = [
        t(lang, 'automation.rolequota.report.title', { emoji: EMOJI.MEMBERS, role: `<@&${role.id}>`, days: rule.period_days, min: rule.min_messages }),
        t(lang, 'automation.rolequota.report.totals', { met: result.met, missed: result.missed, removed: result.removed, excused: result.excused, fresh: result.fresh }),
        ...(removedIds.length ? [t(lang, 'automation.rolequota.report.removed', { list: mentionList(removedIds) })] : []),
        ...(missedIds.length ? [t(lang, 'automation.rolequota.report.missed', { max: rule.max_strikes, list: mentionList(missedIds.filter((id) => !removedIds.includes(id))) })] : []),
        ...(failedIds.length ? [t(lang, 'automation.rolequota.report.failed', { list: mentionList(failedIds) })] : []),
        ...(toTell.length > sentDms && rule.notify_dm ? [t(lang, 'automation.rolequota.report.dmLimit', { count: toTell.length - sentDms })] : []),
      ];
      await channel.send({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch((err) => logger.warn(`Role quotas: could not post the report in guild ${guild.id}: ${err.message}`));
    }
  }
  return result;
}

/** Closes every period that is over (any server this bot is in). One rule failing never stops the others. */
async function runDueRules(client, options = {}) {
  const due = await quotasDb.listDueRules();
  for (const rule of due) {
    try {
      await closeRule(client, rule, options);
    } catch (err) {
      logger.warn(`Role quotas: could not close the period of role ${rule.role_id} in guild ${rule.guild_id}: ${err.message}`);
    }
  }
  return due.length;
}

// ---- Reminder before the end and who is below now ------------------------------------------------------------------------------

/** The members who hold the role and are below the quota right now, from the counts: `[{ member, messages, strikes }]` (excused and new members are not below, they are not judged). */
async function membersBelow(guild, rule, { now = Date.now() } = {}) {
  const role = guild.roles.cache.get(rule.role_id);
  if (!role) return { role: null, below: [], excused: 0, fresh: 0, total: 0 };
  await guild.members.fetch().catch(() => null);
  const holders = [...role.members.values()].filter((member) => !member.user.bot);
  const rows = new Map((await quotasDb.listMembers(guild.id, rule.role_id)).map((row) => [row.user_id, row]));
  const result = { role, below: [], excused: 0, fresh: 0, total: holders.length };
  for (const member of holders) {
    const row = rows.get(member.id) ?? null;
    const verdict = judge(row, rule, rule.period_started_at, now);
    if (verdict === 'excused') result.excused += 1;
    else if (verdict === 'new') result.fresh += 1;
    else if (verdict === 'missed') result.below.push({ member, messages: Number(row?.messages ?? 0), strikes: Number(row?.strikes ?? 0) });
  }
  result.below.sort((a, b) => a.messages - b.messages);
  return result;
}

/** Tells the members who are below the quota that the period ends soon (`remind_hours` before), once for each period. Returns how many were told. */
async function remindRule(client, rule, { now = new Date(), sleep = wait } = {}) {
  const guild = client.guilds.cache.get(rule.guild_id);
  if (!guild) return null;
  const lang = await guildLanguage(guild.id);
  const { role, below } = await membersBelow(guild, rule, { now: now.getTime() });
  await quotasDb.markReminded(rule); // once for each period, whatever happens next
  if (!role || !below.length) return 0;
  const endsAt = Math.floor((new Date(rule.period_started_at).getTime() + rule.period_days * DAY_MS) / 1000);
  let sent = 0;
  for (const entry of below) {
    if (sent >= DM_LIMIT) break;
    const text = t(lang, 'automation.rolequota.dm.remind', { emoji: EMOJI.ALERT, server: guild.name, role: role.name, messages: entry.messages, min: rule.min_messages, left: Math.max(0, rule.min_messages - entry.messages), end: `<t:${endsAt}:R>`, strikes: entry.strikes, max: rule.max_strikes });
    await sendDm(entry.member, { components: [textCard(text)], flags: MessageFlags.IsComponentsV2 }, { guild, kind: 'rolequota' }).then(() => { sent += 1; }).catch(() => {});
    await sleep(DM_GAP_MS);
  }
  return sent;
}

/** Sends the reminders that are due (any server this bot is in). One rule failing never stops the others. */
async function runReminders(client, options = {}) {
  const due = await quotasDb.listRemindable();
  for (const rule of due) {
    try {
      await remindRule(client, rule, options);
    } catch (err) {
      logger.warn(`Role quotas: could not send the reminders of role ${rule.role_id} in guild ${rule.guild_id}: ${err.message}`);
    }
  }
  return due.length;
}

module.exports = {
  MAX_RULES, MAX_PERIOD_DAYS, MAX_MESSAGES, MAX_STRIKES, MAX_EXCUSE_DAYS, DAY_MS,
  MAX_CHANNELS, MAX_REMIND_HOURS, CHANNEL_MODES,
  validateRule, validateChannels, countsIn, judge, applyResult, noteMessage, handleMemberUpdate, closeRule, runDueRules, membersBelow, remindRule, runReminders, flush,
};

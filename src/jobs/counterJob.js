// Live counters: channels whose name shows a number (members, humans, boosts...) or a clock.
//
// Discord lets a channel be renamed twice every ten minutes. Each counter keeps the times of its last renames (in the
// database too, so a restart does not forget them) and is renamed:
//   - at once when something it counts changes (a member joins or leaves, a boost, a new channel...) and the budget allows,
//   - otherwise once, at the moment the budget allows again, with the value of that moment (updates in between are merged),
//   - never when the name would stay the same.
// A full pass every minute catches what no event says (a clock, a countdown) and repairs a name changed by hand.
// A deleted channel turns its counter off; a missing permission is said once (the server's notices and the list show it).
const { Events, PermissionFlagsBits } = require('discord.js');
const countersDb = require('../db/counters');
const database = require('../db/database');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { renderName, planRename, recentRenames, targetOf, NEEDS_MEMBERS, NEEDS_PRESENCES, RENAME_WINDOW_MS } = require('../utils/counterNames');
const { countGuild, extrasFor } = require('../utils/counterValues');
const { milestoneToAnnounce, announcePayload, announceChannel } = require('../utils/counterAnnounce');
const { createRenameQueue } = require('../utils/renameQueue');
const { t, guildLanguage } = require('../i18n');
const { botDay } = require('../utils/botTime');

const INTERVAL_MS = 60_000;
const RENAME_TIMEOUT_MS = 15_000;
// Counting bots, pending members or boosters needs every member, and the cache only holds the ones that
// were seen. A full fetch is heavy, so it is repeated at most this often and skipped for very large servers.
const MEMBER_REFRESH_MS = 10 * 60_000;
const MEMBER_FETCH_TIMEOUT_MS = 60_000;
const MEMBER_FETCH_MAX_GUILD = 50_000;
const WARN_EVERY_MS = 60 * 60_000;
// How long events are gathered before the counters of a server are looked at: a raid of 50 joins is one look, not 50.
const QUICK_DEBOUNCE_MS = 3_000;
const SLOW_DEBOUNCE_MS = 20_000;

// Which counters an event can change.
const MEMBER_TYPES = ['members', 'goal', 'users_only', 'bots_only', 'pending_members', 'booster_count', 'role_members', 'online', 'status_online', 'status_idle', 'status_dnd', 'in_voice'];
const CHANNEL_TYPES = ['all_channels', 'text_channels', 'voice_channels', 'categories', 'announcement_channels', 'staging_channels'];

const state = {
  client: null,
  rowsByGuild: new Map(), // guild id -> rows, from the last read of the database
  renameTimes: new Map(), // channel id -> the times of its last renames
  blockedUntil: new Map(), // channel id -> a rate limit Discord gave for it
  timers: new Map(), // channel id -> { timer, at } of the rename waiting for the budget
  inFlight: new Set(),
  lastWanted: new Map(),
  lastStored: new Map(),
  problems: new Map(), // row id -> the problem already said
  dirty: new Map(), // guild id -> { timer, at }
  memberFetchedAt: new Map(),
  lastWarnAt: new Map(),
  announce: new Map(), // guild id -> its milestone announcement settings (enabled ones only)
  announcing: new Set(), // guild ids whose milestone is being looked at
  milestoneTimers: new Map(), // guild id -> timer of the next look after joins
  now: () => Date.now(),
  queue: null, // the line of every rename of the bot (renameQueue.js)
  lastPassAt: 0, // when the last full pass started
  memberDaysAt: 0, // when the member counts of the day were last saved
  prunedDay: null,
};
state.queue = createRenameQueue({ now: () => state.now() });

function withTimeout(promise, ms, label) {
  let timer;
  // i18n-ignore: internal error, only logged
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms / 1000}s`), { timedOut: true })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function warnOnce(key, ...args) {
  const now = state.now();
  if (now - (state.lastWarnAt.get(key) ?? 0) < WARN_EVERY_MS) return;
  state.lastWarnAt.set(key, now);
  logger.warn(...args);
}

/** Makes the member cache complete enough for the counters that need it. Falls back to what is cached. */
async function ensureMembers(guild, option) {
  if (!NEEDS_MEMBERS.has(option)) return;
  if ((guild.memberCount ?? 0) > MEMBER_FETCH_MAX_GUILD) return;
  if (guild.members.cache.size >= (guild.memberCount ?? 0)) return;
  const last = state.memberFetchedAt.get(guild.id) ?? 0;
  if (state.now() - last < MEMBER_REFRESH_MS) return;
  state.memberFetchedAt.set(guild.id, state.now());
  try {
    await withTimeout(guild.members.fetch(), MEMBER_FETCH_TIMEOUT_MS, 'member fetch'); // i18n-ignore: log label
  } catch (err) {
    // i18n-ignore: log
    warnOnce(`members:${guild.id}`, { guildId: guild.id, action: 'counter-members' }, `Could not load every member for counters, using the cached ones: ${err.message}`);
  }
}

function timesOf(row) {
  const known = state.renameTimes.get(row.channel_id) ?? [];
  const saved = Array.isArray(row.rename_times) ? row.rename_times.map(Number) : [];
  const merged = recentRenames([...new Set([...known, ...saved])], state.now());
  state.renameTimes.set(row.channel_id, merged);
  return merged;
}

async function saveRow(row, patch) {
  Object.assign(row, patch);
  await database.from('server_counters').update(patch).eq('id', row.id).catch(() => {});
}

/** Says a problem once (a missing channel, a missing permission) and keeps it on the row for `!counter list` and the dashboard. */
async function setProblem(guild, row, problem, { disable = false, detail = '' } = {}) {
  if (state.problems.get(row.id) === problem && row.problem === problem && !(disable && row.enabled)) return;
  state.problems.set(row.id, problem);
  const patch = { problem, problem_at: new Date(state.now()).toISOString() };
  if (disable) patch.enabled = false;
  if (row.problem !== problem || disable) {
    // A permission problem is worded so the server's notices pick it up and tell the staff (once, and again only if it comes back).
    // i18n-ignore: log
    const text = problem === 'missing_permission' ? `Missing Permissions: Petto needs Manage Channels and View Channel on the counter channel ${row.channel_id}.${detail ? ` ${detail}` : ''}`
      : problem === 'bad_target' ? `Counter channel ${row.channel_id} has no topic (only text and announcement channels do); the counter waits until it shows in the name.` // i18n-ignore: log
        : `Counter channel ${row.channel_id} is gone; the counter was turned off.`; // i18n-ignore: log
    logger.warn({ guildId: guild.id, channelId: row.channel_id, action: 'counter' }, text);
  }
  await saveRow(row, patch);
}

async function clearProblem(row) {
  state.problems.delete(row.id);
  if (row.problem) await saveRow(row, { problem: null, problem_at: null });
}

function cancelTimer(channelId) {
  const pending = state.timers.get(channelId);
  if (pending) clearTimeout(pending.timer);
  state.timers.delete(channelId);
}

function scheduleLater(guildId, row, at) {
  const pending = state.timers.get(row.channel_id);
  if (pending && pending.at <= at) return;
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    state.timers.delete(row.channel_id);
    const guild = state.client?.guilds?.cache?.get(guildId);
    const fresh = (state.rowsByGuild.get(guildId) ?? []).find((r) => r.channel_id === row.channel_id);
    if (guild && fresh) processCounter(guild, fresh).catch((err) => logger.error('Counter rename failed:', err));
  }, Math.max(1000, at - state.now()));
  timer.unref?.();
  state.timers.set(row.channel_id, { timer, at });
}

function canManage(guild, channel) {
  const me = guild.members?.me;
  if (!me || typeof channel.permissionsFor !== 'function') return true;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has?.(PermissionFlagsBits.ManageChannels) && perms?.has?.(PermissionFlagsBits.ViewChannel));
}

/** The name a counter wants now, with the value it shows. */
async function wantedNameOf(guild, row, lang) {
  await ensureMembers(guild, row.counter_option);
  const now = state.now();
  const value = countGuild(guild, row.counter_option, lang, row, now);
  return { name: renderName(row, value, lang, extrasFor(guild, row, value, now)), value };
}

/**
 * What a counter needs now: { result } when there is nothing to send ('off', 'problem', 'waiting', 'same'), or { channel, name, plan }
 * with the plan of the budget ('now' or 'later').
 */
async function evaluate(guild, row, language) {
  if (!row.enabled) { cancelTimer(row.channel_id); return { result: 'off' }; }
  const channel = guild.channels.cache.get(row.channel_id);
  if (!channel) { cancelTimer(row.channel_id); await setProblem(guild, row, 'missing_channel', { disable: true }); return { result: 'problem' }; }
  if (!canManage(guild, channel)) { await setProblem(guild, row, 'missing_permission'); return { result: 'problem' }; }
  if (state.inFlight.has(channel.id)) return { result: 'waiting' };
  const topic = targetOf(row) === 'topic';
  // Only text and announcement channels have a topic.
  if (topic && channel.type !== 0 && channel.type !== 5) { await setProblem(guild, row, 'bad_target'); return { result: 'problem' }; }
  const { name } = await wantedNameOf(guild, row, language);
  const plan = planRename({
    currentName: topic ? String(channel.topic ?? '') : channel.name,
    wantedName: name,
    channelType: topic ? 'topic' : row.channel_type,
    lastWanted: state.lastWanted.get(channel.id),
    lastStored: state.lastStored.get(channel.id),
    times: timesOf(row),
    now: state.now(),
    minGapMs: Math.max(0, (Number(row.interval_seconds) || 60) - 60) * 1000,
    blockedUntil: state.blockedUntil.get(channel.id) ?? 0,
  });
  if (plan.action === 'skip') {
    cancelTimer(channel.id);
    if (row.problem && row.problem !== 'missing_channel') await clearProblem(row);
    return { result: 'same' };
  }
  if (plan.action === 'later') { scheduleLater(guild.id, row, plan.at); return { result: 'waiting' }; }
  return { channel, name, plan };
}

/** Sends one rename to Discord. The budget counts it from the moment it is asked for, whatever Discord answers. */
async function applyRename(guild, row, channel, name, language) {
  cancelTimer(channel.id);
  state.inFlight.add(channel.id);
  const times = [...timesOf(row), state.now()];
  state.renameTimes.set(channel.id, times);
  const topic = targetOf(row) === 'topic';
  try {
    const edit = topic ? channel.setTopic(name, t(language, 'counters.renameReason')) : channel.setName(name, t(language, 'counters.renameReason'));
    const renamed = await withTimeout(edit, RENAME_TIMEOUT_MS, 'channel rename'); // i18n-ignore: 'channel rename' is a log label
    state.lastWanted.set(channel.id, name);
    state.lastStored.set(channel.id, (topic ? renamed?.topic : renamed?.name) ?? name);
    state.problems.delete(row.id);
    await saveRow(row, { rename_times: times, last_name: name, last_updated_at: new Date(state.now()).toISOString(), ...(row.problem ? { problem: null, problem_at: null } : {}) });
    return 'renamed';
  } catch (err) {
    const code = err?.code ?? err?.rawError?.code;
    if (code === 10003) { await setProblem(guild, row, 'missing_channel', { disable: true }); return 'problem'; }
    if (code === 50013 || code === 50001) { await setProblem(guild, row, 'missing_permission'); return 'problem'; }
    // A rate limit or a request still waiting in discord.js: nothing is asked again for this channel until the window is over.
    if (err?.timedOut || err?.status === 429 || code === 429) state.blockedUntil.set(channel.id, state.now() + RENAME_WINDOW_MS);
    await saveRow(row, { rename_times: times });
    // i18n-ignore: log
    warnOnce(`rename:${channel.id}`, { guildId: guild.id, channelId: channel.id, action: 'counter-rename' }, `Could not update counter channel: ${err.message}`);
    return 'problem';
  } finally {
    state.inFlight.delete(channel.id);
  }
}

/**
 * Looks at one counter: renames it (through the line of every rename of the bot), plans the rename for when the budget allows, or does
 * nothing. Returns what happened: 'renamed', 'waiting', 'same', 'off', 'problem'.
 */
async function processCounter(guild, row, { lang = null } = {}) {
  const started = await startCounter(guild, row, lang ?? await guildLanguage(guild.id));
  return typeof started === 'string' ? started : started.queued;
}

/** Looks at a counter and, when it must be renamed, puts the rename in the line. Resolves (the line's promise) when it is done. */
async function startCounter(guild, row, language) {
  const first = await evaluate(guild, row, language);
  if (first.result) return first.result;
  const done = state.queue.push(first.channel.id, guild.id, async () => {
    // Its turn came: the value, the channel and the budget are read again, as they are at this moment.
    const fresh = (state.rowsByGuild.get(guild.id) ?? []).find((r) => r.id === row.id) ?? row;
    const now = await evaluate(guild, fresh, language);
    if (now.result) return now.result;
    return applyRename(guild, fresh, now.channel, now.name, language);
  });
  return { queued: done };
}

async function loadRows() {
  const rows = await countersDb.listAll();
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.guild_id)) grouped.set(row.guild_id, []);
    grouped.get(row.guild_id).push(row);
  }
  state.rowsByGuild = grouped;
  try {
    state.announce = new Map((await countersDb.listAnnounce()).map((config) => [config.guild_id, config]));
  } catch (err) {
    // i18n-ignore: log
    warnOnce('announce:list', { action: 'counter-announce' }, `Could not read the milestone announcements: ${err.message}`);
  }
  return grouped;
}

/**
 * Looks at the member count of a server and announces the milestone it reached, if any. The number is saved first, so a crash, a
 * restart or two looks at once never send it twice. Returns the number announced, or null.
 */
async function checkMilestone(guild, { lang = null } = {}) {
  const config = state.announce.get(guild.id);
  if (!config?.enabled || !config.channel_id || state.announcing.has(guild.id)) return null;
  state.announcing.add(guild.id);
  try {
    const count = guild.memberCount ?? guild.members?.cache?.size ?? 0;
    const plan = milestoneToAnnounce({ count, last: config.last_announced, every: config.every, goalRows: state.rowsByGuild.get(guild.id) ?? [], useGoals: config.use_goals !== false });
    if (!plan) return null;
    if (plan.start !== undefined) {
      config.last_announced = plan.start;
      await countersDb.markAnnounced(guild.id, plan.start).catch(() => {});
      return null;
    }
    const channel = announceChannel(guild, config);
    if (!channel) {
      // i18n-ignore: log
      warnOnce(`announce:${guild.id}`, { guildId: guild.id, channelId: config.channel_id, action: 'counter-announce' }, `Missing Permissions: Petto cannot send the milestone announcement in channel ${config.channel_id} (it needs View Channel and Send Messages).`);
      return null;
    }
    config.last_announced = plan.milestone;
    await countersDb.markAnnounced(guild.id, plan.milestone);
    const language = lang ?? await guildLanguage(guild.id);
    const payload = await announcePayload(guild, channel, config, { count, milestone: plan.milestone }, language);
    await channel.send(payload).catch((err) => {
      // i18n-ignore: log
      warnOnce(`announce-send:${guild.id}`, { guildId: guild.id, channelId: channel.id, action: 'counter-announce' }, `Could not send the milestone announcement: ${err.message}`);
    });
    return plan.milestone;
  } catch (err) {
    logger.error('Counter milestone check failed:', err);
    return null;
  } finally {
    state.announcing.delete(guild.id);
  }
}

/** Members joined: the milestone is looked at after a short wait (a raid of joins is one look). */
function scheduleMilestone(guildId, delay = QUICK_DEBOUNCE_MS) {
  if (!state.announce.get(guildId)?.enabled || state.milestoneTimers.has(guildId)) return false;
  const timer = setTimeout(() => {
    state.milestoneTimers.delete(guildId);
    const guild = state.client?.guilds?.cache?.get(guildId);
    if (guild) checkMilestone(guild).catch(() => {});
  }, delay);
  timer.unref?.();
  state.milestoneTimers.set(guildId, timer);
  return true;
}

/** Reads the announcement settings of one server again (after a change from `!counter announce` or the dashboard). */
async function reloadAnnounce(guildId) {
  const config = await countersDb.getAnnounce(guildId);
  if (config?.enabled) state.announce.set(guildId, config); else state.announce.delete(guildId);
  return config;
}

/**
 * Looks at every counter of one server, reading its rows again first when `reload` is set (after a change from a command or the dashboard).
 * The renames it needs all go in the line at once; with `wait: false` it does not wait for them to be sent (the full pass every minute).
 */
async function refreshGuildCounters(client, guildId, { reload = false, channelId = null, wait = true } = {}) {
  if (client) state.client = client;
  const guild = state.client?.guilds?.cache?.get(guildId);
  if (!guild) return [];
  if (reload) {
    const rows = await countersDb.list(guildId);
    if (rows.length) state.rowsByGuild.set(guildId, rows); else state.rowsByGuild.delete(guildId);
  }
  const lang = await guildLanguage(guildId);
  const started = [];
  for (const row of state.rowsByGuild.get(guildId) ?? []) {
    if (channelId && row.channel_id !== channelId) continue;
    started.push({ channelId: row.channel_id, result: await startCounter(guild, row, lang) });
  }
  if (!channelId) await checkMilestone(guild, { lang });
  if (!wait) {
    for (const entry of started) if (typeof entry.result !== 'string') entry.result.queued.catch((err) => logger.error('Counter rename failed:', err));
    return started.map((entry) => ({ channelId: entry.channelId, result: typeof entry.result === 'string' ? entry.result : 'queued' }));
  }
  return Promise.all(started.map(async (entry) => ({ channelId: entry.channelId, result: typeof entry.result === 'string' ? entry.result : await entry.result.queued })));
}

/** The time of the next rename a counter is waiting for, if any (for the dashboard and the list). One waiting in the line goes now. */
function pendingRenameAt(channelId) {
  return state.timers.get(channelId)?.at ?? (state.queue.queuedAt(channelId) !== null ? state.now() : null);
}

async function updateCounters(client, { wait = true } = {}) {
  state.client = client;
  state.lastPassAt = state.now();
  const grouped = await loadRows();
  await forEachWithConcurrency(grouped, async ([guildId]) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    await refreshGuildCounters(client, guildId, { wait });
  }, config.jobConcurrency);
  // Servers that announce milestones without having counters.
  for (const guildId of state.announce.keys()) {
    if (grouped.has(guildId)) continue;
    const guild = client.guilds.cache.get(guildId);
    if (guild) await checkMilestone(guild);
  }
}

const MEMBER_DAYS_EVERY_MS = 60 * 60_000;
const MEMBER_DAYS_KEEP = 90;

/**
 * Saves the member count of every server of the bot for today (one row per server and day, the last value wins), at most once an hour,
 * and once a day removes the days older than 90. For the small line of members on the dashboard.
 */
async function snapshotMembers(client, { force = false } = {}) {
  const now = state.now();
  if (!force && now - state.memberDaysAt < MEMBER_DAYS_EVERY_MS) return 0;
  state.memberDaysAt = now;
  const day = botDay(new Date(now));
  const rows = [...(client?.guilds?.cache?.values?.() ?? [])].filter((guild) => typeof guild.memberCount === 'number').map((guild) => ({ guildId: guild.id, members: guild.memberCount }));
  try {
    const saved = await countersDb.saveMemberDays(day, rows);
    if (state.prunedDay !== day) {
      state.prunedDay = day;
      await countersDb.pruneMemberDays(botDay(new Date(now - MEMBER_DAYS_KEEP * 86_400_000)));
    }
    return saved;
  } catch (err) {
    // i18n-ignore: log
    warnOnce('member-days', { action: 'counter-member-days' }, `Could not save the member counts of the day: ${err.message}`);
    return 0;
  }
}

/**
 * What the dashboard shows about one counter besides its name: when it changed last, when it changes next, and the small problems that
 * are not saved on the row (no presences for an online count, a server too big to read every member, a rate limit from Discord).
 */
function counterStatus(guild, row) {
  const now = state.now();
  const badges = [];
  if (row.problem) badges.push(row.problem);
  if (row.enabled === false) badges.push('off');
  if (NEEDS_PRESENCES.has(row.counter_option) || row.counter_option === 'role_online') {
    if (!guild.presences?.cache?.size) badges.push('no_presences');
  }
  if ((NEEDS_MEMBERS.has(row.counter_option)) && (guild.memberCount ?? 0) > MEMBER_FETCH_MAX_GUILD) badges.push('members_partial');
  const blocked = state.blockedUntil.get(row.channel_id) ?? 0;
  if (blocked > now) badges.push('rate_limited');
  const pending = pendingRenameAt(row.channel_id);
  return {
    badges,
    last_updated_at: row.last_updated_at ? Date.parse(row.last_updated_at) || null : null,
    next_rename_at: pending,
    queued: state.queue.queuedAt(row.channel_id) !== null,
    next_check_at: state.lastPassAt ? state.lastPassAt + INTERVAL_MS : null,
  };
}

/** Something a counter of this server may show changed: the counters of those types are looked at after a short wait. */
function markDirty(guildId, types, delay = QUICK_DEBOUNCE_MS) {
  const rows = state.rowsByGuild.get(guildId);
  if (!rows?.some((row) => row.enabled && types.includes(row.counter_option))) return false;
  const pending = state.dirty.get(guildId);
  const at = state.now() + delay;
  if (pending && pending.at <= at) return true;
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    state.dirty.delete(guildId);
    refreshGuildCounters(state.client, guildId, { wait: false }).catch((err) => logger.error('Counter update failed:', err));
  }, delay);
  timer.unref?.();
  state.dirty.set(guildId, { timer, at });
  return true;
}

/** The events that change what counters show. Each one only wakes up the servers that have a counter of that kind. */
function attachCounterEvents(client) {
  const on = (event, fn) => client.on(event, (...args) => { try { fn(...args); } catch (err) { logger.error('Counter event failed:', err); } });
  on(Events.GuildMemberAdd, (member) => { markDirty(member.guild.id, MEMBER_TYPES); scheduleMilestone(member.guild.id); });
  on(Events.GuildMemberRemove, (member) => markDirty(member.guild.id, MEMBER_TYPES));
  on(Events.GuildMemberUpdate, (before, after) => {
    if (before.pending !== after.pending || Boolean(before.premiumSince) !== Boolean(after.premiumSince) || before.roles?.cache?.size !== after.roles?.cache?.size) {
      markDirty(after.guild.id, ['pending_members', 'booster_count', 'role_members']);
    }
  });
  on(Events.GuildUpdate, (before, after) => {
    if (before.premiumSubscriptionCount !== after.premiumSubscriptionCount || before.premiumTier !== after.premiumTier) markDirty(after.id, ['boosts', 'boost_level']);
  });
  on(Events.ChannelCreate, (channel) => channel.guild && markDirty(channel.guild.id, CHANNEL_TYPES));
  on(Events.ChannelDelete, (channel) => {
    if (!channel.guild) return;
    const row = (state.rowsByGuild.get(channel.guild.id) ?? []).find((r) => r.channel_id === channel.id);
    if (row) { cancelTimer(channel.id); setProblem(channel.guild, row, 'missing_channel', { disable: true }).catch(() => {}); }
    markDirty(channel.guild.id, CHANNEL_TYPES);
  });
  on(Events.GuildRoleCreate, (role) => markDirty(role.guild.id, ['roles']));
  on(Events.GuildRoleDelete, (role) => markDirty(role.guild.id, ['roles', 'role_members']));
  on(Events.GuildEmojiCreate, (emoji) => markDirty(emoji.guild.id, ['emojis']));
  on(Events.GuildEmojiDelete, (emoji) => markDirty(emoji.guild.id, ['emojis']));
  on(Events.GuildStickerCreate, (sticker) => sticker.guild && markDirty(sticker.guild.id, ['stickers']));
  on(Events.GuildStickerDelete, (sticker) => sticker.guild && markDirty(sticker.guild.id, ['stickers']));
  on(Events.VoiceStateUpdate, (before, after) => {
    if (Boolean(before.channelId) !== Boolean(after.channelId)) markDirty(after.guild.id, ['in_voice'], SLOW_DEBOUNCE_MS);
  });
  on(Events.PresenceUpdate, (before, after) => {
    if (!after?.guild || before?.status === after.status) return;
    markDirty(after.guild.id, [...NEEDS_PRESENCES], SLOW_DEBOUNCE_MS);
  });
  // A rename Discord made wait: no more renames are asked for that channel until the wait is over.
  client.rest?.on?.('rateLimited', (info) => {
    const match = /\/channels\/(\d{15,25})$/.exec(String(info?.url ?? info?.route ?? ''));
    if (!match || String(info?.method ?? '').toUpperCase() !== 'PATCH') return;
    const wait = Number(info.retryAfter ?? info.timeToReset ?? 0);
    if (wait > 0) state.blockedUntil.set(match[1], state.now() + wait);
  });
}

function startCounterJob(client) {
  state.client = client;
  attachCounterEvents(client);
  // The pass only puts the renames in the line: a server with many changes never holds up the others.
  const run = exclusiveTask(() => updateCounters(client, { wait: false }));
  run().catch((err) => logger.error('Initial counter update failed:', err));
  setInterval(() => run().catch((err) => logger.error('Counter job error:', err)), INTERVAL_MS).unref?.();
  // The member count of the day, for the line on the dashboard: a little after the start, then every hour.
  setTimeout(() => snapshotMembers(client).catch(() => {}), 90_000).unref?.();
  setInterval(() => snapshotMembers(client).catch(() => {}), MEMBER_DAYS_EVERY_MS).unref?.();
  logger.info('Counter job started (checking every 60s, renames kept under 2 per 10 minutes per channel and spread out over time).');
}

module.exports = { startCounterJob, updateCounters, refreshGuildCounters, processCounter, markDirty, pendingRenameAt, attachCounterEvents, countGuild, checkMilestone, scheduleMilestone, reloadAnnounce, snapshotMembers, counterStatus, _state: state };

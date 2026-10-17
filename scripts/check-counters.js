// Checks live counters without a bot or a database: how a counter turns into a channel name (types, templates, number
// formats, goals, clocks), the rename budget of Discord (two renames per channel every ten minutes: never more, changes in
// between merged into one rename, kept across a restart), deleted channels and missing permissions, `!counter create`'s
// reader, and the locked channels the setup makes.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// The database, the logger, the config and Premium, replaced before anything loads them.
let rows = [];
const updates = [];
const warnings = [];
const added = [];
let premium = false;
let announceRows = [];
const announced = [];
stub('src/db/counters.js', {
  listAll: async () => rows,
  list: async (guildId) => rows.filter((r) => r.guild_id === guildId),
  add: async (row) => { const saved = { id: 100 + added.length, enabled: true, rename_times: [], ...row }; added.push(saved); rows.push(saved); return saved; },
  get: async (guildId, channelId) => rows.find((r) => r.guild_id === guildId && r.channel_id === channelId) ?? null,
  update: async () => null,
  remove: async () => true,
  listAnnounce: async () => announceRows.filter((r) => r.enabled),
  getAnnounce: async (guildId) => announceRows.find((r) => r.guild_id === guildId) ?? null,
  saveAnnounce: async (guildId, patch) => { let row = announceRows.find((r) => r.guild_id === guildId); if (!row) { row = { guild_id: guildId, enabled: true, use_goals: true }; announceRows.push(row); } Object.assign(row, patch); return row; },
  markAnnounced: async (guildId, number) => { announced.push([guildId, number]); const row = announceRows.find((r) => r.guild_id === guildId); if (row) row.last_announced = number; return true; },
});
stub('src/db/database.js', { from: () => ({ update: (patch) => ({ eq: (column, id) => { updates.push({ id, ...patch }); return Promise.resolve({}); } }) }) });
stub('src/utils/logger.js', { info() {}, error(...args) { warnings.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); }, warn(...args) { warnings.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); } });
stub('src/config.js', { jobConcurrency: 2 });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premium }), getGuildLimits: (p) => ({ counters: p?.active ? 25 : 6 }) });

const names = require('../src/utils/counterNames');
const { renderName, normalizeForType, formatCount, nextGoal, resolveOption, resolveFormat, planRename, nextRenameAt, timeValue, defaultTemplate, RENAME_WINDOW_MS } = names;

// ── Names ─────────────────────────────────────────────────────────────────
// Old rows keep the names they had.
assert.equal(renderName({ counter_option: 'members', name_template: '{option}: {value}', prefix: '', suffix: '' }, 12), 'members: 12');
assert.equal(renderName({ counter_option: 'boosts', name_template: 'Boosts {value}!', prefix: '> ', suffix: ' <' }, 3), '> Boosts 3! <');
assert.equal(renderName({ counter_option: 'members', name_template: '', prefix: '', suffix: '' }, 12, 'es'), 'miembros: 12');
assert.equal(renderName({ counter_option: 'text_channels', name_template: '{option}: {value}', prefix: '', suffix: '' }, 3, 'pt-BR'), 'canais de texto: 3');
assert.equal(renderName({ counter_option: 'x', name_template: 'a'.repeat(150) }, 1).length, 100);
// `{count}` with each format, in each language.
const row = (extra) => ({ counter_option: 'members', name_template: 'Members: {count}', ...extra });
assert.equal(renderName(row({ number_format: 'plain' }), 12345), 'Members: 12345');
assert.equal(renderName(row({ number_format: 'grouped' }), 1234567), 'Members: 1,234,567');
assert.equal(renderName(row({ number_format: 'grouped' }), 1234, 'es'), 'Members: 1.234');
assert.equal(renderName(row({ number_format: 'compact' }), 1234), 'Members: 1.2k');
assert.equal(renderName(row({ number_format: 'compact' }), 1234, 'pt-BR'), 'Members: 1,2k');
assert.equal(formatCount(999, 'compact'), '999');
assert.equal(formatCount(1999, 'compact'), '1.9k', 'never rounded up past the real count');
assert.equal(formatCount(125_400, 'compact'), '125k');
assert.equal(formatCount(2_500_000, 'compact'), '2.5M');
assert.equal(formatCount('12:30', 'compact'), '12:30');
// An emoji is never cut in half at the 100-character limit.
assert.equal(renderName({ counter_option: 'members', name_template: `${'a'.repeat(99)}😀` }, 1), 'a'.repeat(99));
// Goals, roles and percentages.
assert.equal(nextGoal(87), 90);
assert.equal(nextGoal(450), 500);
assert.equal(nextGoal(1234), 1250);
assert.equal(nextGoal(0), 10);
assert.equal(nextGoal(120, 500), 500, 'a goal set by the server is used until reached');
assert.equal(nextGoal(600, 500), 700, 'then the next round number');
assert.equal(renderName({ counter_option: 'goal', name_template: '🎯 {count}/{goal} · {left} left · {percent}', number_format: 'grouped', goal: 2000 }, 1500), '🎯 1,500/2,000 · 500 left · 75%');
assert.equal(renderName({ counter_option: 'role_members', name_template: '{role}: {count}' }, 7, 'en', { role: 'Staff' }), 'Staff: 7');
// Default names come in the server's language.
assert.equal(defaultTemplate('users_only', 'en'), '👤 Humans: {count}');
assert.equal(defaultTemplate('users_only', 'es'), '👤 Humanos: {count}');
assert.equal(defaultTemplate('1790000000', 'pt-BR'), '⏰ {count}');
// Clocks go in steps of five minutes, in the time zone; dates in the language.
const at = Date.UTC(2026, 9, 17, 14, 38, 20);
assert.equal(timeValue('clock', { now: at, timeZone: 'UTC' }), '14:35');
assert.equal(timeValue('clock', { now: at, timeZone: 'Asia/Tokyo' }), '23:35');
assert.equal(timeValue('clock', { now: at, timeZone: 'Not/AZone' }), '14:35', 'an unknown zone falls back to UTC');
assert.match(timeValue('date', { now: at, timeZone: 'UTC', lang: 'es' }), /17 oct 2026/);
assert.equal(renderName({ counter_option: 'clock', name_template: '🕒 {count} {tz}', timezone: 'UTC' }, '14:35', 'en', { now: at }), '🕒 14:35 UTC');
// What people type.
assert.equal(resolveOption('Humans'), 'users_only');
assert.equal(resolveOption('bots'), 'bots_only');
assert.equal(resolveOption('in-voice'), 'in_voice');
assert.equal(resolveOption('boostlevel'), 'boost_level');
assert.equal(resolveOption('role'), 'role_members');
assert.equal(resolveOption('1790000000'), '1790000000');
assert.equal(resolveOption('nonsense'), null);
assert.equal(resolveFormat('1.2k') ?? resolveFormat('short'), 'compact');
assert.equal(resolveFormat('comma'), 'grouped');
assert.equal(normalizeForType('Members: 12', 'text'), 'members:-12');
assert.equal(normalizeForType('Members: 12', 'voice'), 'Members: 12');

// ── The rename budget ─────────────────────────────────────────────────────
const NOW = 10_000_000;
const plan = (extra) => planRename({ wantedName: 'Members 12', channelType: 'voice', now: NOW, ...extra });
assert.deepEqual(plan({ currentName: 'Members 12' }), { action: 'skip' }, 'never rename to the same name');
assert.deepEqual(plan({ currentName: 'members-12', channelType: 'text' }), { action: 'skip' }, 'a text channel with the normalized name is the same name');
assert.deepEqual(plan({ currentName: 'Members 11' }), { action: 'now' });
assert.deepEqual(plan({ currentName: 'Members 11', times: [NOW - 60_000] }), { action: 'now' }, 'the second rename of ten minutes goes at once');
const third = plan({ currentName: 'Members 11', times: [NOW - 120_000, NOW - 60_000] });
assert.equal(third.action, 'later', 'a third rename within ten minutes waits');
assert.equal(third.at, NOW - 120_000 + RENAME_WINDOW_MS + 5_000, 'until the older rename leaves the window, with a margin');
assert.deepEqual(plan({ currentName: 'Members 11', times: [NOW - RENAME_WINDOW_MS - 1, NOW - 60_000] }), { action: 'now' }, 'renames older than ten minutes do not count');
assert.equal(plan({ currentName: 'Members 11', blockedUntil: NOW + 30_000 }).at, NOW + 30_000, 'a rate limit from Discord is respected');
assert.equal(nextRenameAt([NOW - 10_000], NOW, { minGapMs: 120_000 }), NOW + 110_000, 'a longer interval asked by the server is kept');
// Discord rewrote the wanted name in its own way: not asked again for the same value; a name changed by hand is fixed.
assert.deepEqual(plan({ wantedName: 'Members: 12', currentName: 'members12', channelType: 'text', lastWanted: 'Members: 12', lastStored: 'members12' }), { action: 'skip' });
assert.deepEqual(plan({ wantedName: 'Members: 12', currentName: 'my-own-name', channelType: 'text', lastWanted: 'Members: 12', lastStored: 'members12' }), { action: 'now' });
// Every possible order of renames stays under two per ten minutes.
{
  const times = [];
  for (let t = 0; t < 60 * 60_000; t += 7_000) {
    if (planRename({ currentName: `n${t}`, wantedName: `w${t}`, channelType: 'voice', times, now: t }).action === 'now') times.push(t);
  }
  for (const t of times) assert.ok(times.filter((x) => x > t - RENAME_WINDOW_MS && x <= t).length <= 2, 'never more than two renames in ten minutes');
  assert.ok(times.length >= 11, 'and the budget is used: about two renames every ten minutes');
}

// ── Values ────────────────────────────────────────────────────────────────
const { countGuild } = require('../src/utils/counterValues');

function coll(entries) {
  const map = new Map(entries);
  return Object.assign(map, { filter(fn) { const found = [...map.values()].filter(fn); return { size: found.length }; }, find(fn) { return [...map.values()].find(fn); } });
}
function makeGuild() {
  const roles = coll([['1', { id: '1', name: '@everyone' }], ['r1', { id: 'r1', name: 'Staff' }], ['r2', { id: 'r2', name: 'VIP' }]]);
  const member = (id, { bot = false, roleIds = [], booster = false } = {}) => ({ id, user: { bot }, premiumSince: booster ? new Date() : null, roles: { cache: new Map(roleIds.map((r) => [r, true])) } });
  const members = coll([['a', member('a', { roleIds: ['r1'] })], ['b', member('b', { booster: true })], ['c', member('c', { bot: true })]]);
  const channels = coll([]);
  return {
    id: '1', memberCount: 3, premiumSubscriptionCount: 4, premiumTier: 1,
    roles: { cache: roles, everyone: { id: '1' } },
    members: { cache: members, me: null, fetchCalls: 0, async fetch() { this.fetchCalls += 1; return members; } },
    channels: { cache: channels, async create(options) { const c = channel(String(900 + channels.size), options.name, { 0: 0, 2: 2, 4: 4 }[options.type] ?? 2); c.options = options; channels.set(c.id, c); return c; } },
    presences: { cache: coll([['a', { status: 'online' }], ['b', { status: 'idle' }], ['c', { status: 'dnd' }], ['d', { status: 'offline' }]]) },
    voiceStates: { cache: coll([['a', { channelId: 'v' }], ['b', { channelId: null }]]) },
    emojis: { cache: coll([['e', {}], ['f', {}]]) }, stickers: { cache: coll([['s', {}]]) },
  };
}
function channel(id, name, type) {
  const calls = [];
  return { id, name, type, calls, parentId: null, async setName(next) { calls.push(next); this.name = type === 0 ? next.toLowerCase().replace(/\s+/g, '-') : next; return this; } };
}
{
  const guild = makeGuild();
  const value = (option, extra = {}) => countGuild(guild, option, 'en', extra);
  assert.equal(value('members'), 3);
  assert.equal(value('users_only'), 2);
  assert.equal(value('bots_only'), 1);
  assert.equal(value('booster_count'), 1);
  assert.equal(value('boosts'), 4);
  assert.equal(value('boost_level'), 1);
  assert.equal(value('online'), 3, 'online counts every status but offline');
  assert.equal(value('status_online'), 1);
  assert.equal(value('status_idle'), 1);
  assert.equal(value('status_dnd'), 1);
  assert.equal(value('in_voice'), 1);
  assert.equal(value('roles'), 2, '@everyone is not counted');
  assert.equal(value('emojis'), 2);
  assert.equal(value('stickers'), 1);
  assert.equal(value('role_members', { target_id: 'r1' }), 1);
  assert.equal(value('role_members', { target_id: 'gone' }), 0);
  assert.equal(value('goal'), 3);
  assert.match(String(value('2000000000')), /^\d+d \d+h$/);
}

// ── `!counter create` reader ──────────────────────────────────────────────
const counterCommand = require('../src/commands/misc/counter');
const read = counterCommand.parseCreateText;
assert.deepEqual(read('members'), { type: 'members' });
assert.deepEqual(read('humans 👤 People: {count} <#123456789012345678>'), { type: 'humans', template: '👤 People: {count}', category: '<#123456789012345678>' });
assert.deepEqual(read('members voice'), { type: 'members', kind: 'voice' }, 'the old `!counter add members voice` still works');
assert.deepEqual(read('role <@&123456789012345678> "{role}: {count}"'), { type: 'role', role: '<@&123456789012345678>', template: '{role}: {count}' });
assert.deepEqual(read('goal --goal 500 --format compact Goal {count}/{goal}'), { type: 'goal', goal: '500', format: 'compact', template: 'Goal {count}/{goal}' });
assert.deepEqual(read('clock --tz Europe/Madrid'), { type: 'clock', timezone: 'Europe/Madrid' });
assert.equal(counterCommand.prefixOnly, true, '!counter is never a slash command');

// ── The job ───────────────────────────────────────────────────────────────
const job = require('../src/jobs/counterJob');
const state = job._state;
let clock = 50_000_000;
state.now = () => clock;

(async () => {
  const guild = makeGuild();
  const voice = channel('10', 'old', 2);
  const text = channel('11', 'old', 0);
  const bots = channel('12', 'old', 2);
  for (const c of [voice, text, bots]) guild.channels.cache.set(c.id, c);
  // Only one member in the cache at first: bots are counted after a fetch of every member.
  const allMembers = [...guild.members.cache.entries()];
  guild.members.cache.clear(); guild.members.cache.set(...allMembers[0]);
  guild.members.fetch = async function fetch() { this.fetchCalls = (this.fetchCalls ?? 0) + 1; for (const [k, v] of allMembers) guild.members.cache.set(k, v); return guild.members.cache; };
  const base = { guild_id: '1', channel_type: 'voice', prefix: '', suffix: '', enabled: true, interval_seconds: 60, rename_times: [] };
  rows = [
    { ...base, id: 1, channel_id: '10', counter_option: 'members', name_template: '{option}: {value}' },
    { ...base, id: 2, channel_id: '11', counter_option: 'boosts', channel_type: 'text', name_template: 'Boosts {value}' },
    { ...base, id: 3, channel_id: '12', counter_option: 'bots_only', name_template: 'Bots {count}' },
    { ...base, id: 4, channel_id: '99', counter_option: 'members', name_template: '' },
  ];
  const client = { guilds: { cache: new Map([['1', guild]]) } };

  await job.updateCounters(client);
  assert.deepEqual(voice.calls, ['members: 3']);
  assert.deepEqual(text.calls, ['Boosts 4']);
  assert.deepEqual(bots.calls, ['Bots 1'], 'bots are counted from every member, not only the cached ones');
  assert.equal(guild.members.fetchCalls, 1);
  // A deleted channel turns its counter off and says why, once.
  const gone = rows.find((r) => r.id === 4);
  assert.equal(gone.enabled, false); assert.equal(gone.problem, 'missing_channel');
  assert.ok(updates.some((u) => u.id === 4 && u.enabled === false && u.problem === 'missing_channel'));
  // The rename is saved with its time, so a restart knows the budget.
  assert.deepEqual(updates.find((u) => u.id === 1 && u.last_name).rename_times, [clock]);

  // A second pass finds nothing to rename (the text channel kept Discord's form of the name).
  await job.updateCounters(client);
  assert.equal(voice.calls.length + text.calls.length + bots.calls.length, 3);
  const goneWarnings = warnings.filter((w) => w.includes('is gone')).length;
  assert.equal(goneWarnings, 1, 'a deleted channel is reported once');

  // Members join: the second rename of ten minutes goes at once...
  clock += 30_000;
  guild.memberCount = 4;
  assert.equal(job.markDirty('1', ['members']), true);
  assert.equal(job.markDirty('2', ['members']), false, 'a server without counters is not looked at');
  await job.refreshGuildCounters(client, '1');
  assert.deepEqual(voice.calls, ['members: 3', 'members: 4']);
  // ...a third change within ten minutes waits, and further changes are merged into that one rename.
  clock += 30_000;
  guild.memberCount = 5;
  assert.equal(await job.processCounter(guild, rows[0]), 'waiting');
  const pending = job.pendingRenameAt('10');
  assert.equal(pending, clock - 60_000 + RENAME_WINDOW_MS + 5_000);
  guild.memberCount = 6;
  assert.equal(await job.processCounter(guild, rows[0]), 'waiting');
  assert.equal(job.pendingRenameAt('10'), pending, 'one waiting rename, not two');
  assert.equal(voice.calls.length, 2, 'no rename beyond the budget');
  // When the budget frees up, the rename shows the value of that moment.
  clock = pending;
  assert.equal(await job.processCounter(guild, rows[0]), 'renamed');
  assert.deepEqual(voice.calls.at(-1), 'members: 6');
  // Back to the same number before the wait is over: nothing is renamed at all.
  clock += 10_000;
  guild.memberCount = 7;
  assert.equal(await job.processCounter(guild, rows[0]), 'waiting');
  guild.memberCount = 6;
  assert.equal(await job.processCounter(guild, rows[0]), 'same');
  assert.equal(job.pendingRenameAt('10'), null, 'the waiting rename is cancelled');

  // A restart: the times come from the database, the budget is still respected.
  state.renameTimes.clear(); state.timers.forEach((p) => clearTimeout(p.timer)); state.timers.clear();
  rows[0].rename_times = [clock - 20_000, clock - 10_000];
  guild.memberCount = 8;
  assert.equal(await job.processCounter(guild, rows[0]), 'waiting', 'renames saved before a restart still count');

  // A missing permission is reported once, worded for the server's notices, and the counter is kept.
  const locked = channel('13', 'old', 2);
  locked.permissionsFor = () => ({ has: () => false });
  guild.channels.cache.set(locked.id, locked);
  guild.members.me = { id: 'me' };
  const lockedRow = { ...base, id: 5, channel_id: '13', counter_option: 'members', name_template: '' };
  rows.push(lockedRow);
  assert.equal(await job.processCounter(guild, lockedRow), 'problem');
  assert.equal(await job.processCounter(guild, lockedRow), 'problem');
  assert.equal(warnings.filter((w) => w.includes('Missing Permissions') && w.includes('13')).length, 1, 'reported once');
  assert.equal(lockedRow.problem, 'missing_permission'); assert.equal(lockedRow.enabled, true);
  assert.deepEqual(locked.calls, []);
  // Fixed: the problem clears on the next rename.
  locked.permissionsFor = () => ({ has: () => true });
  assert.equal(await job.processCounter(guild, lockedRow), 'renamed');
  assert.equal(lockedRow.problem, null);

  // A rename Discord refuses with Unknown Channel turns the counter off; one that times out blocks the channel for the window.
  const vanishing = channel('14', 'old', 2);
  vanishing.setName = async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); };
  guild.channels.cache.set(vanishing.id, vanishing);
  const vanishingRow = { ...base, id: 6, channel_id: '14', counter_option: 'members', name_template: '' };
  assert.equal(await job.processCounter(guild, vanishingRow), 'problem');
  assert.equal(vanishingRow.enabled, false);
  const slow = channel('15', 'old', 2);
  slow.setName = async () => { throw Object.assign(new Error('timed out'), { timedOut: true }); };
  guild.channels.cache.set(slow.id, slow);
  const slowRow = { ...base, id: 7, channel_id: '15', counter_option: 'members', name_template: '' };
  assert.equal(await job.processCounter(guild, slowRow), 'problem');
  assert.ok(state.blockedUntil.get('15') >= clock + RENAME_WINDOW_MS - 1);
  assert.equal(await job.processCounter(guild, slowRow), 'waiting', 'no new rename while Discord makes it wait');
  state.timers.forEach((p) => clearTimeout(p.timer)); state.timers.clear();

  // ── Setup: locked channels, limits ─────────────────────────────────────
  const { createCounter, setupPreset } = require('../src/utils/counterSetup');
  const fresh = makeGuild();
  fresh.members.me = { id: 'me' };
  rows = [];
  const result = await setupPreset(fresh, { createdBy: 'u', reason: 'r' }, 'en');
  assert.equal(result.ok, true);
  assert.equal(result.category.name, '📊 Server stats');
  assert.deepEqual(result.made.map((m) => m.name), ['👥 Members: 3', '👤 Humans: 2', '🤖 Bots: 1']);
  const made = result.made[0].channel.options;
  assert.equal(made.type, 2, 'a voice channel');
  assert.equal(made.parent, result.category.id);
  const everyone = made.permissionOverwrites.find((o) => o.id === '1');
  const { PermissionFlagsBits } = require('discord.js');
  assert.ok(everyone.allow.includes(PermissionFlagsBits.ViewChannel) && everyone.deny.includes(PermissionFlagsBits.Connect), 'everyone sees it, nobody joins');
  assert.ok(made.permissionOverwrites.find((o) => o.id === 'me').allow.includes(PermissionFlagsBits.ManageChannels), 'Petto keeps the right to rename it');
  assert.equal((await setupPreset(fresh, { createdBy: 'u' }, 'en')).error, 'already');
  // An existing channel can become a counter; the free limit is 6, Premium 25.
  const own = channel('777', 'stats', 2); fresh.channels.cache.set(own.id, own);
  const existing = await createCounter(fresh, { type: 'online', channelId: '777', createdBy: 'u' }, 'es');
  assert.equal(existing.ok, true); assert.equal(existing.name, '🟢 Conectados: 3'); assert.equal(rows.at(-1).channel_id, '777');
  assert.equal((await createCounter(fresh, { type: 'online', channelId: '777', createdBy: 'u' }, 'en')).error, 'alreadyCounter');
  assert.equal((await createCounter(fresh, { type: 'role', createdBy: 'u' }, 'en')).error, 'needRole');
  assert.equal((await createCounter(fresh, { type: 'clock', timezone: 'Mars/Base', createdBy: 'u' }, 'en')).error, 'badTimezone');
  assert.equal((await createCounter(fresh, { type: 'what', createdBy: 'u' }, 'en')).error, 'unknownType');
  const role = await createCounter(fresh, { type: 'role', roleId: 'r1', format: 'compact', createdBy: 'u' }, 'en');
  assert.equal(role.ok, true); assert.equal(role.name, '🏷️ Staff: 1'); assert.equal(role.row.number_format, 'compact');
  assert.equal((await createCounter(fresh, { type: 'goal', goal: 50, createdBy: 'u' }, 'en')).name, '🎯 Goal: 3/50');
  const full = await createCounter(fresh, { type: 'emojis', createdBy: 'u' }, 'en');
  assert.equal(full.error, 'limitFree'); assert.equal(full.count, 6); assert.equal(full.premium, 25);
  premium = true;
  assert.equal((await createCounter(fresh, { type: 'emojis', createdBy: 'u' }, 'en')).ok, true);

  // ── Packs: !counter setup <pack> and the dashboard gallery ──────────────
  const { resolvePreset, nextGoal, PRESETS } = require('../src/utils/counterSetup');
  assert.deepEqual(Object.keys(PRESETS), ['basic', 'boosts', 'online', 'goal', 'clock']);
  assert.equal(resolvePreset('Meta'), 'goal'); assert.equal(resolvePreset('impulsos'), 'boosts'); assert.equal(resolvePreset('nope'), null);
  assert.deepEqual([87, 940, 5234, 48000, 0].map(nextGoal), [90, 1000, 6000, 50000, 10], 'the next round goal');
  premium = false;
  const packs = makeGuild(); packs.members.me = { id: 'me' }; rows = [];
  const boosts = await setupPreset(packs, { createdBy: 'u', preset: 'boost' }, 'es');
  assert.equal(boosts.ok, true); assert.equal(boosts.category.name, '💎 Mejoras');
  assert.deepEqual(rows.map((r) => r.counter_option), ['boosts', 'booster_count', 'boost_level']);
  const goalPack = await setupPreset(packs, { createdBy: 'u', preset: 'goal' }, 'en');
  assert.equal(rows.at(-1).goal, 10, 'the goal pack aims at the next round number'); assert.equal(goalPack.made[0].name, '🎯 Goal: 3/10');
  assert.equal((await setupPreset(packs, { createdBy: 'u', preset: 'goal', goal: '500' }, 'en')).made[0].name, '🎯 Goal: 3/500', 'or the goal given');
  assert.equal((await setupPreset(packs, { createdBy: 'u', preset: 'boosts' }, 'en')).error, 'presetHave', 'a pack the server already has adds nothing');
  assert.equal((await setupPreset(packs, { createdBy: 'u', preset: 'what' }, 'en')).error, 'unknownPreset');
  assert.equal((await setupPreset(packs, { createdBy: 'u', preset: 'clock', timezone: 'Mars/Base' }, 'en')).error, 'badTimezone');
  const online = await setupPreset(packs, { createdBy: 'u', preset: 'online' }, 'en');
  assert.equal(online.ok, true); assert.equal(online.made.length, 1, 'only what fits the free limit of 6'); assert.equal(online.skipped, 2);
  assert.equal((await setupPreset(packs, { createdBy: 'u', preset: 'clock' }, 'en')).error, 'limitFree');
  const command = require('../src/commands/misc/counter');
  assert.deepEqual(command.parseSetupText('goal 1.000'), { preset: 'goal', goal: '1000' });
  assert.deepEqual(command.parseSetupText('clock America/New_York'), { preset: 'clock', timezone: 'America/New_York' });
  assert.deepEqual(command.parseSetupText(''), {});
  assert.equal(command.prefixSubcommandAliases.preset, 'setup');

  // ── Milestone announcements ────────────────────────────────────────────
  {
    const { milestoneToAnnounce, nextMilestone, parseEvery, renderAnnounceText, announceVars } = require('../src/utils/counterAnnounce');
    const goalRow = (goal = null) => ({ counter_option: 'goal', enabled: true, goal });
    assert.deepEqual(milestoneToAnnounce({ count: 4523, last: null, every: 100 }), { start: 4523 }, 'the first look only sets where to start: nothing already passed is announced');
    assert.equal(milestoneToAnnounce({ count: 4599, last: 4523, every: 100 }), null);
    assert.deepEqual(milestoneToAnnounce({ count: 4600, last: 4523, every: 100 }), { milestone: 4600 }, 'every 100 members');
    assert.equal(milestoneToAnnounce({ count: 4600, last: 4600, every: 100 }), null, 'never twice for the same number');
    assert.equal(milestoneToAnnounce({ count: 4601, last: 4600, every: 100 }), null);
    assert.equal(milestoneToAnnounce({ count: 4600, last: 4600, every: 100, goalRows: [goalRow()] }), null, 'members who leave and join again around it do not announce it again');
    assert.deepEqual(milestoneToAnnounce({ count: 4850, last: 4600, every: 100 }), { milestone: 4800 }, 'a raid of joins announces only the highest number passed');
    assert.deepEqual(milestoneToAnnounce({ count: 500, last: 480, goalRows: [goalRow(500)] }), { milestone: 500 }, 'the goal of a goal counter');
    assert.equal(milestoneToAnnounce({ count: 499, last: 480, goalRows: [goalRow(500)] }), null);
    assert.equal(milestoneToAnnounce({ count: 500, last: 480, goalRows: [goalRow(500)], useGoals: false }), null, 'goals can be left out');
    assert.deepEqual(milestoneToAnnounce({ count: 90, last: 87, goalRows: [goalRow()] }), { milestone: 90 }, 'an automatic goal: the next round number the counter shows');
    assert.deepEqual(milestoneToAnnounce({ count: 131, last: 87, goalRows: [goalRow()] }), { milestone: 125 }, 'the highest automatic goal passed (90, 100, 125)');
    assert.equal(milestoneToAnnounce({ count: 600, last: 480, goalRows: [{ ...goalRow(500), enabled: false }] }), null, 'a counter that is off sets no goal');
    assert.equal(nextMilestone({ count: 4523, last: 4500, every: 100 }), 4600);
    assert.equal(nextMilestone({ count: 480, last: 470, every: 1000, goalRows: [goalRow(500)] }), 500);
    assert.equal(nextMilestone({ count: 480, last: 470 }), null, 'nothing to announce');
    assert.equal(parseEvery('100'), 100); assert.equal(parseEvery('1.000'), 1000); assert.equal(parseEvery('off'), null); assert.equal(parseEvery('-5'), undefined); assert.equal(parseEvery('abc'), undefined);
    const vars = announceVars({ name: 'Petto Land' }, { count: 1002, milestone: 1000 }, 'es');
    assert.equal(renderAnnounceText('🎉 {server} llegó a {goal} ({count}) {counter.goal} {unknown}', vars), '🎉 Petto Land llegó a 1.000 (1.002) 1.000 {unknown}');
    const parse = counterCommand.parseAnnounceText;
    assert.deepEqual(parse(''), {});
    assert.deepEqual(parse('<#123456789012345678> 🎉 {goal} members!'), { setting: 'channel', value: '<#123456789012345678>', message: '🎉 {goal} members!' });
    assert.deepEqual(parse('every 100'), { setting: 'every', value: '100' });
    assert.deepEqual(parse('cada 50'), { setting: 'every', value: '50' });
    assert.deepEqual(parse('message Hello {server}'), { setting: 'message', value: 'Hello {server}' });
    assert.deepEqual(parse('embed off'), { setting: 'embed', value: 'off' });
    assert.deepEqual(parse('test'), { setting: 'test' });
    assert.equal(counterCommand.prefixSubcommandAliases.milestone, 'announce');

    // The job: the first look starts from the members of now, a milestone is saved before it is sent, never sent twice.
    const g = makeGuild();
    g.id = '77'; g.name = 'Petto Land'; g.memberCount = 4523;
    const sent = [];
    const hall = { id: '500', name: 'hall', type: 0, async send(payload) { sent.push(payload); return payload; } };
    g.channels.cache.set(hall.id, hall);
    announceRows = [{ guild_id: '77', enabled: true, channel_id: '500', message: '🎉 {server}: {goal} members (now {count})', embed_name: null, every: 100, use_goals: true, last_announced: null }];
    rows = [];
    const announceClient = { guilds: { cache: new Map([['77', g]]) } };
    await job.updateCounters(announceClient);
    assert.equal(sent.length, 0, 'the first look announces nothing');
    assert.deepEqual(announced.at(-1), ['77', 4523]);
    g.memberCount = 4600;
    assert.equal(await job.checkMilestone(g, { lang: 'en' }), 4600);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, '🎉 Petto Land: 4,600 members (now 4,600)');
    assert.deepEqual(sent[0].allowedMentions, { parse: [] }, 'an announcement pings nobody');
    assert.deepEqual(announced.at(-1), ['77', 4600], 'the number is saved');
    g.memberCount = 4599; assert.equal(await job.checkMilestone(g, { lang: 'en' }), null);
    g.memberCount = 4600; assert.equal(await job.checkMilestone(g, { lang: 'en' }), null, 'leaving and joining again does not announce 4,600 twice');
    // A restart reads the saved number: still not announced again.
    job._state.announce.clear();
    await job.updateCounters(announceClient);
    assert.equal(await job.checkMilestone(g, { lang: 'en' }), null);
    assert.equal(sent.length, 1);
    // Two looks at once send one message.
    g.memberCount = 4700;
    const both = await Promise.all([job.checkMilestone(g, { lang: 'en' }), job.checkMilestone(g, { lang: 'en' })]);
    assert.deepEqual(both.filter(Boolean), [4700]); assert.equal(sent.length, 2);
    // Without the right to write there, nothing is sent and it is said once.
    hall.permissionsFor = () => ({ has: () => false }); g.members.me = { id: 'me' };
    g.memberCount = 4800;
    assert.equal(await job.checkMilestone(g, { lang: 'en' }), null); assert.equal(sent.length, 2);
    assert.ok(warnings.some((w) => w.includes('milestone announcement') && w.includes('500')));
    // The default text in each language when the server wrote none.
    hall.permissionsFor = () => ({ has: () => true });
    announceRows[0].message = '';
    job._state.announce.get('77').message = '';
    assert.equal(await job.checkMilestone(g, { lang: 'es' }), 4800);
    assert.equal(sent.at(-1).content, '🎉 ¡**Petto Land** acaba de llegar a **4.800** miembros! Gracias a todos.');
    rows = [];
  }

  console.log('Checked counter names, formats, goals, clocks, the rename budget (2 per 10 minutes, merged, kept across restarts), problems, !counter create, the setup and the packs, and milestone announcements.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

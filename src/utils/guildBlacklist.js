// i18n-ignore-file: the notes of the team are English; what a server reads comes from the catalog (blacklist.* in src/i18n/locales).
// The blacklist of servers: servers that break Petto's terms of service or privacy policy. Petto leaves one it is in, and leaves again the second it is
// added back. The Petto team manages it with `!blacklist` (commands/utility/blacklist.js, prefix only, hidden, silent for everybody else).
//
// Where it is enforced (all from MEMORY: db/guildBlacklist.js keeps the list loaded, so no door waits for the database):
//   - `guildCreate`: events/guildCreateBlacklist.js leaves at once; the loader of events (handlers/eventHandler.js) does not run any other listener of that server;
//   - every other event of that server (`interactionCreate`, `messageCreate`, `guildMemberAdd`...) is ignored by the same loader (`blocksEvent`);
//   - the web and API routes with a `:guildId` answer "not available" (`guardWebGuild`);
//   - at `ready`, `sweep` leaves every blacklisted server Petto is already in, one every second.
const { ContainerBuilder, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } = require('discord.js');
const logger = require('./logger');
const store = require('../db/guildBlacklist');
const { t, peekGuildLanguage } = require('../i18n');
const { detectGuildLanguage } = require('../i18n/detect');
const { sendDm } = require('./dmOrigin');
const { EMOJI } = require('./emojis');
const { SUPPORT_URL, termsUrl, privacyUrl } = require('./links');
const { oneLine, opsNote, SNOWFLAKE_RE } = require('./teamTools');

const LIMITS = Object.freeze({
  reasonMin: 5, reasonMax: 500,
  noticeEveryMs: 24 * 60 * 60 * 1000, // one notice to the owner of a server every 24 hours at most
  opsEveryMs: 10 * 60 * 1000, // one line about the same server in the operations channel every 10 minutes at most
  opsBurst: 5, opsWindowMs: 60 * 1000, // and never more than 5 lines a minute whatever the servers are (a loop cannot flood it)
  sweepGapMs: 1000, // the sweep at start leaves one server every second
  perPage: 8,
});

/** The events whose first argument is a server (its `id` is the server), not an object that carries `guildId`. */
const GUILD_EVENTS = new Set(['guildCreate', 'guildDelete', 'guildUpdate', 'guildAvailable', 'guildUnavailable', 'guildIntegrationsUpdate']);

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The server an event is about, or null: `args` are what the event gives its listeners. */
function guildIdOfEvent(eventName, args) {
  const first = args?.[0];
  if (GUILD_EVENTS.has(eventName)) return first?.id ? String(first.id) : null;
  for (const value of args ?? []) {
    if (!value || typeof value !== 'object') continue;
    // A reaction has its server in `message`; a server given as a later argument (`guildAuditLogEntryCreate(entry, guild)`) is a Guild itself.
    const id = value.guildId ?? value.guild?.id ?? value.channel?.guild?.id ?? value.channel?.guildId ?? value.message?.guildId ?? (value.constructor?.name === 'Guild' ? value.id : null);
    if (id) return String(id);
  }
  return null;
}

/**
 * Whether the loader of events must NOT run a listener for this event: the event is about a blacklisted server. `event.blacklistExempt` marks the listeners
 * that must run anyway (the one that leaves, and the one that notes that Petto left).
 */
function blocksEvent(event, args) {
  if (event?.blacklistExempt) return false;
  const id = guildIdOfEvent(event?.name, args);
  return Boolean(id) && store.isBlacklisted(id);
}

/** A person pressed or typed something in a blacklisted server before Petto left: a private "not available" when the interaction can be answered. Never throws. */
async function refuseInteraction(interaction) {
  try {
    if (!interaction || interaction.replied || interaction.deferred) return;
    if (interaction.isAutocomplete?.()) { await interaction.respond([]); return; }
    if (typeof interaction.reply !== 'function') return;
    await interaction.reply({ content: t(noticeLanguageOf(interaction.guild ?? { id: interaction.guildId }), 'blacklist.unavailable'), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  } catch { /* the interaction expired, or cannot be answered: nothing to do */ }
}

/** `:guildId` of every route of the website and the API: a blacklisted server gets the same answer as a server Petto is not in. */
function guardWebGuild(app) {
  app.param('guildId', (req, res, next, guildId) => {
    if (store.isBlacklisted(guildId)) { res.status(404).json({ ok: false, error: 'guild_unavailable' }); return; }
    next();
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// What a server reads
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The language of a server for the notice: the one Petto has for it, else what Petto can tell from the server (its Community locale, the words of its channels), else English. */
function noticeLanguageOf(guild) {
  try {
    const known = guild?.id ? peekGuildLanguage(guild.id) : 'en';
    if (known && known !== 'en') return known;
    return detectGuildLanguage(guild)?.language ?? 'en';
  } catch { return 'en'; }
}

/** The reason as a server reads it: one block of text that cannot ping or open a link preview. */
const readableReason = (reason) => String(reason ?? '').replace(/\r/g, '').replace(/@/g, '@​').replace(/\b(https?):\/\//gi, '$1:​//').trim();

/** The card for the owner (the same one every time): says Petto left, why, and where to go if it is a mistake. No mention can notify anyone. */
function noticeCard({ lang = 'en', guildName = null, guildId, reason }) {
  const name = oneLine(guildName, 80) || t(lang, 'blacklist.notice.unknownServer');
  const head = new TextDisplayBuilder().setContent(`### ${t(lang, 'blacklist.notice.title', { emoji: EMOJI.WARNING })}`);
  const body = new TextDisplayBuilder().setContent([
    t(lang, 'blacklist.notice.body'),
    t(lang, 'blacklist.notice.server', { name, id: guildId }),
    t(lang, 'blacklist.notice.reason', { reason: readableReason(reason) }),
  ].join('\n'));
  const links = new TextDisplayBuilder().setContent([
    t(lang, 'blacklist.notice.mistake', { support: `<${SUPPORT_URL}>` }),
    t(lang, 'blacklist.notice.terms', { terms: `<${termsUrl(lang)}>` }),
    t(lang, 'blacklist.notice.privacy', { privacy: `<${privacyUrl(lang)}>` }),
  ].join('\n'));
  const container = new ContainerBuilder().setAccentColor(0xfe6465).addTextDisplayComponents(head, body, links);
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** A text channel of the server where Petto may write: the system channel first, then the first one by position. */
function writableChannel(guild) {
  const me = guild?.members?.me;
  if (!me) return null;
  const ok = (channel) => Boolean(channel?.isTextBased?.() && !channel.isThread?.() && channel.send
    && channel.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]));
  if (ok(guild.systemChannel)) return guild.systemChannel;
  const channels = [...(guild.channels?.cache?.values?.() ?? [])].filter((channel) => channel.isTextBased?.() && !channel.isThread?.())
    .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));
  return channels.find(ok) ?? null;
}

/**
 * Tells the server why. The owner by direct message first (from "Petto", no server behind it); when the owner cannot be written to and Petto is still in
 * the server (`guild` given), the system channel or the first channel Petto can write in. Returns `'owner_dm'`, `'channel'` or null. Never throws.
 */
async function sendNotice(client, { guild = null, guildId, ownerId, guildName, reason }) {
  const lang = noticeLanguageOf(guild ?? { id: guildId });
  const payload = noticeCard({ lang, guildName: guildName ?? guild?.name, guildId, reason });
  const owner = ownerId ? await client.users.fetch(String(ownerId)).catch(() => null) : null;
  if (owner) {
    // "From Petto" (no server) and not the buttons that report to the team: it is Petto talking about a decision of the team.
    const sent = await sendDm(owner, payload, { guild: null, kind: 'notice', plain: true }).then(() => true, () => false);
    if (sent) return 'owner_dm';
  }
  const channel = guild ? writableChannel(guild) : null;
  if (channel) {
    const sent = await channel.send(payload).then(() => true, () => false);
    if (sent) return 'channel';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The operations channel: one line, and a limit so a loop cannot flood it
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const opsLast = new Map(); // `${kind}:${guildId}` -> when the last line about it was posted
let opsWindow = []; // when each of the last lines was posted

/** Posts `text` unless a line about the same server went out in the last 10 minutes or 5 went out in the last minute. Returns true when it was posted. */
async function limitedOpsNote(client, kind, guildId, text, { now = Date.now() } = {}) {
  const key = `${kind}:${guildId}`;
  if (now - (opsLast.get(key) ?? 0) < LIMITS.opsEveryMs) return false;
  opsWindow = opsWindow.filter((at) => now - at < LIMITS.opsWindowMs);
  if (opsWindow.length >= LIMITS.opsBurst) return false;
  opsLast.set(key, now);
  opsWindow.push(now);
  if (opsLast.size > 2000) for (const [oldKey, at] of opsLast) if (now - at > LIMITS.opsEveryMs) opsLast.delete(oldKey);
  return Boolean(await opsNote(client, text));
}

const forgetLimits = () => { opsLast.clear(); opsWindow = []; };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Leaving, adding, the sweep
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** Petto leaves the server. true when it did. The way out is the same one everywhere (`guild.leave()`), so what Petto stores for it is handled by `guildDelete`. */
async function leave(guild) {
  try { await guild.leave(); return true; } catch (error) {
    logger.warn({ action: 'blacklist' }, `Petto could not leave the blacklisted server ${guild?.id}: ${error.message}`);
    return false;
  }
}

/** Whether the owner may be told now: nothing went out in the last 24 hours (the table says it, and so does the memory of this process). */
const noticeDue = (entry, now = Date.now()) => !entry?.notified_at || now - new Date(entry.notified_at).getTime() >= LIMITS.noticeEveryMs;

/**
 * The server is blacklisted and Petto is in it now (the team added it, or the sweep found it): tell the owner (and the server, if the owner cannot be written
 * to), leave, write it down, and say so in the operations channel. `force`: the notice goes out even if one went out today (the team just added the server).
 */
async function enforceInside(client, guild, entry, { via = 'add', addedBy = null, force = false } = {}) {
  const facts = { guildName: guild.name ?? entry.guild_name, guildId: guild.id, ownerId: guild.ownerId ?? entry.owner_id, members: guild.memberCount ?? null };
  const noticeBy = force || noticeDue(entry) ? await sendNotice(client, { guild, guildId: guild.id, ownerId: facts.ownerId, guildName: facts.guildName, reason: entry.reason }).catch(() => null) : 'recent';
  if (noticeBy && noticeBy !== 'recent') await store.markNotified(guild.id).catch(() => {});
  const left = await leave(guild);
  if (left) await store.markLeft(guild.id).catch(() => {});
  const lines = [
    `**${via === 'sweep' ? 'Blacklisted server found at start' : 'Server blacklisted'}**${left ? ': Petto left it.' : ': Petto could NOT leave it (see the log).'}`,
    `Name: ${oneLine(facts.guildName, 80) || 'unknown'}`,
    `ID: \`${guild.id}\``,
    `Owner: \`${facts.ownerId ?? 'unknown'}\``,
    `Members: ${facts.members ?? 'unknown'}`,
    `Reason: ${oneLine(entry.reason, 500)}`,
    `By: ${addedBy ? `<@${addedBy}> (\`${addedBy}\`)` : oneLine(entry.added_by, 30)}`,
    `Notice to the server: ${{ owner_dm: 'direct message to the owner', channel: 'a channel of the server', recent: 'not sent (one went out in the last 24 hours)' }[noticeBy] ?? 'could not be delivered'}`,
  ].join('\n');
  const posted = await opsNote(client, lines);
  return { left, noticeBy, posted: Boolean(posted) };
}

/**
 * Adds a server to the blacklist. The entry is saved FIRST; then, when Petto is in the server: the notice, the leaving and the note for the team.
 * Returns `{ created, row, present, left, noticeBy }`; `created: false` means the server was already on the list (nothing changed).
 */
async function blacklistGuild(client, { guildId, reason, addedBy }) {
  const guild = client.guilds.cache.get(String(guildId)) ?? null;
  const { created, row } = await store.add({ guildId, reason, addedBy, guildName: guild?.name ?? null, ownerId: guild?.ownerId ?? null });
  if (!created) return { created: false, row, present: Boolean(guild), left: false, noticeBy: null };
  if (!guild) return { created: true, row, present: false, left: false, noticeBy: null };
  const done = await enforceInside(client, guild, row, { via: 'add', addedBy, force: true });
  return { created: true, row: store.entryOf(guildId) ?? row, present: true, left: done.left, noticeBy: done.noticeBy };
}

/**
 * A blacklisted server added Petto. The FIRST thing: leave (the notice and the note come after, so the server sees Petto come and go in the same second).
 * Then: count the attempt, tell the owner (once every 24 hours), and one line for the team (rate limited). Returns true when the server is blacklisted.
 */
async function handleJoin(client, guild) {
  const entry = store.entryOf(guild.id);
  if (!entry) return false;
  const left = await leave(guild);
  const row = await store.recordAttempt(guild.id).catch(() => null) ?? entry;
  if (left) await store.markLeft(guild.id).catch(() => {});
  if (noticeDue(row)) {
    const by = await sendNotice(client, { guild: null, guildId: guild.id, ownerId: guild.ownerId, guildName: guild.name ?? row.guild_name, reason: row.reason }).catch(() => null);
    if (by) await store.markNotified(guild.id).catch(() => {});
  }
  await limitedOpsNote(client, 'join', guild.id, [
    `**A blacklisted server tried to add Petto${left ? '' : ' (and Petto could NOT leave it)'}.**`,
    `Name: ${oneLine(guild.name ?? row.guild_name, 80) || 'unknown'} · ID: \`${guild.id}\` · Owner: \`${guild.ownerId ?? row.owner_id ?? 'unknown'}\``,
    `Attempts: ${row.attempts ?? 1} · Reason: ${oneLine(row.reason, 300)}`,
  ].join('\n'));
  return true;
}

let sweeping = false;
/** At start: leaves every blacklisted server Petto is in, one every second (not all at once). Returns how many it dealt with. */
async function sweep(client, { gapMs = LIMITS.sweepGapMs, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (sweeping) return 0;
  sweeping = true;
  let dealt = 0;
  try {
    const guilds = [...client.guilds.cache.values()].filter((guild) => store.isBlacklisted(guild.id));
    for (const guild of guilds) {
      const entry = store.entryOf(guild.id);
      if (!entry) continue;
      await enforceInside(client, guild, entry, { via: 'sweep' }).catch((error) => logger.warn({ action: 'blacklist' }, `The sweep could not deal with ${guild.id}: ${error.message}`));
      dealt += 1;
      if (dealt < guilds.length) await sleep(gapMs);
    }
  } finally { sweeping = false; }
  return dealt;
}

/** Takes a server off the list. Returns `{ removed, stillByEnvironment }`. A server that left stays out until it adds Petto again. */
async function unblacklistGuild(guildId) {
  const { row, stillByEnvironment } = await store.remove(guildId);
  return { removed: Boolean(row), stillByEnvironment };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The text of `!blacklist`
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The reason, checked: `{ ok: true, reason }` or `{ ok: false, error: 'missing' | 'short' | 'long' }`. Control characters are dropped, the rest is kept. */
function checkReason(text) {
  const reason = String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  const length = [...reason].length;
  if (!length) return { ok: false, error: 'missing' };
  if (length < LIMITS.reasonMin) return { ok: false, error: 'short' };
  if (length > LIMITS.reasonMax) return { ok: false, error: 'long', length };
  return { ok: true, reason };
}

const WORDS = Object.freeze({
  remove: new Set(['remove', 'rm', 'delete', 'del', 'unblacklist']),
  list: new Set(['list', 'ls']),
  info: new Set(['info', 'show', 'check']),
});

/**
 * What the team typed after `!blacklist` / `petto blacklist`, as an action:
 *   `{ action: 'help' }` · `{ action: 'list', page }` · `{ action: 'info' | 'remove', target }` (an ID or a name, text) ·
 *   `{ action: 'add', target: { id } | { name }, reason }` (the server is an ID, a "quoted name", or the longest start of the words that is a server name).
 * `names` is a function that gives the servers of Petto called exactly like a text, so the parser can tell where the name ends and the reason starts.
 */
function parseBlacklistText(text, { names = () => [] } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { action: 'help' };
  const tokens = raw.split(/\s+/);
  const first = tokens[0].toLowerCase();
  const rest = raw.slice(tokens[0].length).trim();
  if (WORDS.list.has(first)) {
    const page = Number.parseInt(tokens[1], 10);
    return { action: 'list', page: Number.isInteger(page) && page > 0 ? page : 1 };
  }
  if (WORDS.remove.has(first)) return { action: 'remove', target: rest.replace(/^["'“”]|["'“”]$/g, '').trim() };
  if (WORDS.info.has(first)) return { action: 'info', target: rest.replace(/^["'“”]|["'“”]$/g, '').trim() };

  if (SNOWFLAKE_RE.test(tokens[0])) return { action: 'add', target: { id: tokens[0] }, reason: rest };
  const quoted = /^["'“](.+?)["'”]\s*([\s\S]*)$/.exec(raw);
  if (quoted) return { action: 'add', target: { name: quoted[1].trim() }, reason: quoted[2].trim() };
  // An unquoted name: the longest start of the words that is exactly the name of a server of Petto (at least one word is left for the reason).
  for (let k = tokens.length - 1; k >= 1; k -= 1) {
    const name = tokens.slice(0, k).join(' ');
    if (names(name).length) return { action: 'add', target: { name }, reason: tokens.slice(k).join(' ') };
  }
  return { action: 'add', target: { name: tokens[0] }, reason: rest };
}

module.exports = {
  LIMITS, GUILD_EVENTS, guildIdOfEvent, blocksEvent, refuseInteraction, guardWebGuild,
  noticeLanguageOf, noticeCard, writableChannel, sendNotice, limitedOpsNote, forgetLimits, noticeDue,
  leave, enforceInside, blacklistGuild, handleJoin, sweep, unblacklistGuild, checkReason, parseBlacklistText,
};

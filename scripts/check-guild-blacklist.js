// The blacklist of servers and the tools of the Petto team (src/utils/guildBlacklist.js, src/db/guildBlacklist.js, src/commands/utility/blacklist.js, team.js,
// leaveguild.js, guildsend.js, guilddebug.js), all with fakes (no Discord, no database):
//   - storage: the table, the in-memory list (a lookup never queries), refresh on every change and from the database, the environment safety net, the protected servers;
//   - `!blacklist` and `petto blacklist`: the parser (id, quoted name, unquoted name, reason limits), add / remove / list (paged) / info, hidden from help, autocomplete,
//     suggestions, the short-alias tables and the catalog generator, and NOBODY outside the team gets any reply (a member, a member with Administrator);
//   - add with Petto inside: the entry is saved FIRST, then the notice (the language of the server, one card, no pings, the links), then the leaving, then the note for the team;
//   - a blacklisted server adds Petto: it leaves FIRST, no other listener of guildCreate runs, no write, no message, the attempts are counted, one notice a day, the notes are limited;
//   - the other doors (interactionCreate, messageCreate, guildMemberAdd, the web routes) and the sweep at `ready`, and `unblacklist` lets a later add stay;
//   - the other tools of the team: `!team` is read from the commands, `!leaveguild` confirms, `!guildsend` and `!guilddebug` show what they did.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const DEV = '900000000000000001';
const ENV_ID = '777000000000000009';
process.env.PETTO_DEVELOPER_IDS = DEV;
process.env.PETTO_BLACKLISTED_GUILD_IDS = `${ENV_ID}, not-an-id, 12`;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { PermissionsBitField, PermissionFlagsBits, MessageFlags } = require('discord.js');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
function patch(relative, overrides) { return Object.assign(require(path.join(root, relative)), overrides); }
const stubPath = require.resolve(path.join(root, 'src/db/database.js'));
const dbChain = { select() { return dbChain; }, eq() { return dbChain; }, maybeSingle: async () => ({ data: null, error: null }) };
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports: { from: () => dbChain } };

const order = []; // what happened, in order
const guildRow = { prefix: '!', prefixes: ['!', 'petto'] };
patch('src/db/guilds.js', { ensureGuild: async () => guildRow, createGuildIfMissing: async () => { order.push('side:createGuildIfMissing'); return { row: { prefix: '!' }, created: true }; } });
patch('src/db/commandAliases.js', { get: async () => null });
patch('src/db/customCommands.js', { getCommand: async () => null });
patch('src/db/disabledCommands.js', { findCached: async () => null, canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => ({}) });
patch('src/db/permissions.js', { hasCommandPermission: async () => true, listGroups: async () => [] });
patch('src/db/memberEvents.js', { getConfig: async () => null });
patch('src/db/logConfig.js', { getLogConfig: async () => ({ entries: [], webhooks: [], ignored: [] }) });
patch('src/db/premium.js', { getGuildPremium: async () => ({ active: true, planKey: 'pro', userId: '1', expiresAt: null }) });
patch('src/db/guildDepartures.js', { clear: async () => { order.push('side:departures.clear'); }, mark: async () => { order.push('side:departures.mark'); } });
patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
patch('src/utils/codeCommands.js', { runCodeCommand: async () => true });
patch('src/logging/extraLog.js', { logCommandUse() {} });
patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
patch('src/utils/logger.js', { info() {}, warn() {}, error() {} });
patch('src/utils/discordOps.js', { sendGuildLifecycleLog: async () => { order.push('side:lifecycleLog'); } });
patch('src/utils/inviteCache.js', { warmGuild: async () => { order.push('side:inviteCache'); } });
patch('src/utils/onboarding.js', { ensureAdminSetupChannel: async () => { order.push('side:setupChannel'); return null; } });
const noticeCalls = [];
patch('src/utils/guildOpsAlerts.js', { sendGuildNotice: async (client, options) => { noticeCalls.push(options); return noticeResult(options); } });
let noticeResult = () => ({ ok: true, deliveryType: 'owner_dm', channel: null });

const config = require('../src/config');
config.opsChannels.general = '555000000000000001';
config.supportGuildId = '444000000000000001';
const { loadCommands, collectCommandData } = require('../src/handlers/commandHandler');
const { makeInvoker } = require('../src/handlers/eventHandler');
const messageEvent = require('../src/events/messageCreateCommands');
const store = require('../src/db/guildBlacklist');
const blacklist = require('../src/utils/guildBlacklist');
const teamTools = require('../src/utils/teamTools');
const help = require('../src/commands/utility/help');
const links = require('../src/utils/links');
const { isHiddenEverywhere, isHiddenWordFor, isTeamOnly } = require('../src/utils/hiddenCommands');
const { SHORT_ALIAS_TABLE } = require('../src/utils/shortAliases');
const generator = require('./gen-short-aliases');
const i18n = require('../src/i18n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(30);
const ANA = '111111111111111111';
const ADMIN = '222222222222222222';
const SPY = '333333333333333333';
const G = (n) => `88000000000000${String(n).padStart(4, '0')}`;
const SUPPORT = config.supportGuildId;

// ------------------------------------------------------------------------------------------------ the fake table, behind the real store
const SQL = store.SQL;
const table = new Map();
let queries = 0;
let failReads = false;
const clock = { now: Date.now() };
async function query(sql, params) {
  queries += 1;
  if (sql === SQL.all) { if (failReads) throw new Error('database down'); return { rows: [...table.values()] }; }
  const id = params[0];
  const row = table.get(id);
  switch (sql) {
    case SQL.get: return { rows: row ? [row] : [] };
    case SQL.insert: {
      order.push('db:insert');
      if (row) return { rows: [] };
      const made = { guild_id: id, reason: params[1], added_by: params[2], added_at: new Date(clock.now), guild_name: params[3], owner_id: params[4], notified_at: null, left_at: null, attempts: 0, last_attempt_at: null };
      table.set(id, made);
      return { rows: [made] };
    }
    case SQL.remove: table.delete(id); return { rows: row ? [row] : [] };
    case SQL.notified: if (row) row.notified_at = new Date(clock.now); return { rows: row ? [row] : [] };
    case SQL.left: if (row) row.left_at = new Date(clock.now); return { rows: row ? [row] : [] };
    case SQL.attempt: if (row) { row.attempts += 1; row.last_attempt_at = new Date(clock.now); order.push('db:attempt'); } return { rows: row ? [row] : [] };
    default: throw new Error(`unexpected statement: ${sql}`);
  }
}
// The store of the bot answers with the real code over the fake table (the module keeps its own functions; they are replaced by the ones made over the fake).
const fake = store.createStore(query, { envIds: () => config.blacklistedGuildIds, protectedIds: () => [config.supportGuildId, config.opsGuildId] });
for (const name of ['load', 'startRefresh', 'stopRefresh', 'isBlacklisted', 'entryOf', 'entries', 'add', 'remove', 'get', 'list', 'markNotified', 'markLeft', 'recordAttempt']) store[name] = fake[name];

// ------------------------------------------------------------------------------------------------ the fake Discord
const dms = [];
const channelSends = [];
const opsPosts = [];
const leaves = [];
const guilds = new Map();
let closedDms = new Set(); // owners that cannot be written to

function makeGuild(n, { name = `Server ${n}`, ownerId = `70000000000000${String(n).padStart(4, '0')}`, locale = 'en-US', members = 120, system = null } = {}) {
  const writable = { id: `66000000000000${String(n).padStart(4, '0')}`, isTextBased: () => true, isThread: () => false, send: async (payload) => { channelSends.push({ guild: G(n), payload }); order.push('notice:channel'); return {}; }, permissionsFor: () => ({ has: () => true }), rawPosition: 0 };
  const guild = {
    id: G(n), name, ownerId, preferredLocale: locale, memberCount: members, available: true, shardId: 0, features: ['COMMUNITY'], joinedTimestamp: Date.now() - 86_400_000, createdTimestamp: Date.now() - 864_000_000,
    members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) } },
    channels: { cache: new Map(system === 'none' ? [] : [[writable.id, writable]]), fetch: async () => new Map(system === 'none' ? [] : [[writable.id, writable]]) },
    systemChannel: system === 'system' ? writable : null,
    leave: async () => { order.push('leave'); leaves.push(G(n)); guilds.delete(G(n)); },
    fetchOwner: async () => { order.push('side:fetchOwner'); return { id: ownerId, user: { id: ownerId } }; },
    fetchAuditLogs: async () => { order.push('side:fetchAuditLogs'); return { entries: { find: () => null } }; },
    iconURL: () => null,
  };
  guild.client = client;
  guilds.set(guild.id, guild);
  return guild;
}

const opsChannel = { id: config.opsChannels.general, isTextBased: () => true, send: async (payload) => { opsPosts.push(typeof payload === 'string' ? payload : payload.content); order.push('ops'); assert.deepEqual(payload.allowedMentions, { parse: [] }, 'a note in the team channel pings nobody'); return {}; } };
const client = {
  user: { id: '123', displayAvatarURL: () => 'https://example.com/a.png' },
  guilds: { cache: guilds, fetch: async (id) => guilds.get(id) ?? Promise.reject(new Error('Unknown Guild')) },
  channels: { cache: new Map([[opsChannel.id, opsChannel]]), fetch: async (id) => (id === opsChannel.id ? opsChannel : Promise.reject(new Error('Unknown Channel'))) },
  users: {
    fetch: async (id) => ({
      id,
      send: async (payload) => {
        if (closedDms.has(id)) throw new Error('Cannot send messages to this user');
        dms.push({ to: id, payload });
        order.push('notice:dm');
        return { id: 'dm' };
      },
    }),
  },
  isReady: () => true,
};
loadCommands(client);
const cmd = (name) => client.commands.get(name);
const text = (payload) => JSON.stringify(JSON.parse(JSON.stringify(payload)));
const dump = (value) => JSON.stringify(typeof value === 'string' ? value : (value?.components ?? []).map((c) => c.toJSON?.() ?? c));

// ------------------------------------------------------------------------------------------------ typing a message, as a person
let seq = 0;
let scriptedClicks = []; // [{ user, which: 'yes' | 'no' }] for the next confirmation
let clickLog = null;
async function send(content, { as = ANA, perms = 0n, guild = null } = {}) {
  const sent = [];
  seq += 1;
  const here = guild ?? { id: `9${String(seq).padStart(17, '0')}`, name: 'Petto Test', members: { cache: new Map(), fetch: async () => new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() } };
  const message = {
    content, author: { id: as, bot: false }, guild: here, guildId: here.id, client,
    member: { id: as, guild: { ownerId: '1' }, permissions: new PermissionsBitField(perms), roles: { cache: new Map(), highest: { position: 1 } } },
    mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
    channel: { id: '5', sendTyping: async () => { sent.push('typing'); }, send: async (payload) => { sent.push(dump(payload)); return {}; } },
    reply: async (payload) => {
      sent.push(dump(payload));
      const buttons = (payload.components ?? []).map((c) => c.toJSON?.() ?? c).filter((c) => c.type === 1).flatMap((row) => row.components);
      const edits = [];
      const reply = {
        id: 'reply', edits,
        delete: async () => {}, edit: async (next) => { edits.push(dump(next)); sent.push(dump(next)); return reply; },
        awaitMessageComponent: async ({ filter, time }) => {
          if (clickLog) clickLog.time = time;
          for (const scripted of scriptedClicks) {
            const customId = buttons.find((b) => b.custom_id.startsWith(scripted.which === 'yes' ? 'teamyes:' : 'teamno:'))?.custom_id;
            const click = { user: { id: scripted.user }, customId, update: async (next) => { sent.push(dump(next)); if (clickLog) clickLog.updated = dump(next); } };
            if (clickLog) (clickLog.tried ??= []).push(scripted.user);
            if (filter(click)) return click;
          }
          throw new Error('time');
        },
      };
      return reply;
    },
  };
  messageEvent.setCachedPrefix(here.id, guildRow.prefixes);
  const before = order.length;
  await messageEvent.execute(message);
  return { sent: sent.filter((entry) => entry !== 'typing'), typed: sent.includes('typing'), isCommand: await messageEvent.isCommandMessage(message), events: order.slice(before), guild: here };
}
const reset = () => { order.length = 0; dms.length = 0; channelSends.length = 0; opsPosts.length = 0; leaves.length = 0; closedDms = new Set(); blacklist.forgetLimits(); scriptedClicks = []; clickLog = null; };

(async () => {
  // ============================================================================================== the table, the files, the environment
  const schema = read('src/db/schema.sql');
  const block = /create table if not exists guild_blacklist \(([\s\S]*?)\n\);/.exec(schema)?.[1] ?? '';
  for (const column of ['guild_id        text primary key', 'reason          text not null', 'added_by        text not null', 'added_at        timestamptz not null default now()', 'guild_name      text', 'owner_id        text', 'notified_at     timestamptz', 'left_at         timestamptz', 'attempts        integer not null default 0', 'last_attempt_at timestamptz']) {
    assert.ok(block.includes(column), `guild_blacklist has the column: ${column}`);
  }
  assert.ok(/alter table guild_blacklist enable row level security;/.test(schema), 'row level security, like the other tables');
  assert.ok(/'guild_blacklist'/.test(read('src/db/guildDepartures.js')), 'the purge of a departed server never deletes the blacklist (KEEP)');
  assert.deepEqual(config.blacklistedGuildIds, [ENV_ID], 'PETTO_BLACKLISTED_GUILD_IDS keeps the valid ids only');
  assert.ok(/guild_blacklist/.test(read('src/db/guildDepartures.js')));
  assert.ok(/blacklist|guildBlacklist/.test(read('src/events/guildDelete.js')), 'guildDelete knows the blacklist');

  // ============================================================================================== the cache: memory, refresh, the environment
  assert.equal(store.isBlacklisted(ENV_ID), false, 'nothing is loaded yet');
  let before = queries;
  await store.load();
  assert.equal(queries, before + 1, 'load reads the table once');
  assert.equal(store.isBlacklisted(ENV_ID), true, 'the environment safety net is merged in at start, with an empty table');
  assert.equal(store.entryOf(ENV_ID).fromEnvironment, true);
  before = queries;
  for (let i = 0; i < 500; i += 1) { store.isBlacklisted(G(1)); store.entryOf(ENV_ID); store.isBlacklisted(ENV_ID); }
  assert.equal(queries, before, 'a lookup never touches the database');
  table.set(G(50), { guild_id: G(50), reason: 'added by another process', added_by: DEV, added_at: new Date(), attempts: 0 });
  assert.equal(store.isBlacklisted(G(50)), false, 'a change of another process is not seen before the next load');
  await store.load();
  assert.equal(store.isBlacklisted(G(50)), true, 'the periodic refresh picks it up');
  failReads = true;
  await store.load();
  assert.ok(store.isBlacklisted(G(50)) && store.isBlacklisted(ENV_ID), 'a database that cannot be read keeps what was loaded and the environment');
  failReads = false;
  table.delete(G(50));
  await store.load();
  assert.equal(store.isBlacklisted(G(50)), false);
  // The environment can add, never remove; the support server is never listed.
  const envOnly = store.createStore(async () => ({ rows: [] }), { envIds: () => [ENV_ID, SUPPORT], protectedIds: () => [SUPPORT] });
  await envOnly.load();
  assert.ok(envOnly.isBlacklisted(ENV_ID) && !envOnly.isBlacklisted(SUPPORT), 'the support server is never on the list, whatever the environment says');
  const gone = await envOnly.remove(ENV_ID);
  assert.deepEqual([gone.row, gone.stillByEnvironment], [null, true], 'removing an id of the environment does nothing');
  assert.equal(envOnly.isBlacklisted(ENV_ID), true);
  assert.equal((await envOnly.recordAttempt(ENV_ID)).attempts, 1, 'the attempts of an id of the environment are counted in memory');
  assert.ok(!(await envOnly.markNotified(G(1))), 'no row, no entry: nothing');

  // ============================================================================================== the parser and the reason
  const names = (list) => (name) => list.filter((entry) => entry.toLowerCase() === String(name).toLowerCase());
  const parse = (textTyped, list = []) => blacklist.parseBlacklistText(textTyped, { names: names(list) });
  assert.deepEqual(parse(''), { action: 'help' });
  assert.deepEqual(parse(`${G(1)} breaking the rules`), { action: 'add', target: { id: G(1) }, reason: 'breaking the rules' });
  assert.deepEqual(parse(`  ${G(1)}   spam   and   scams `), { action: 'add', target: { id: G(1) }, reason: 'spam   and   scams' });
  assert.deepEqual(parse('"My Server" breaking the rules'), { action: 'add', target: { name: 'My Server' }, reason: 'breaking the rules' });
  assert.deepEqual(parse('My Server breaking the rules', ['My Server']), { action: 'add', target: { name: 'My Server' }, reason: 'breaking the rules' }, 'an unquoted name is found by the servers Petto is in');
  assert.deepEqual(parse('My Server breaking the rules', ['My', 'My Server']), { action: 'add', target: { name: 'My Server' }, reason: 'breaking the rules' }, 'the longest name wins');
  assert.deepEqual(parse('Solo breaking the rules', ['Solo']), { action: 'add', target: { name: 'Solo' }, reason: 'breaking the rules' });
  assert.deepEqual(parse('remove 123456789012345678'), { action: 'remove', target: '123456789012345678' });
  assert.deepEqual(parse('rm "My Server"'), { action: 'remove', target: 'My Server' });
  assert.deepEqual(parse('unblacklist 123456789012345678'), { action: 'remove', target: '123456789012345678' });
  assert.deepEqual(parse('list'), { action: 'list', page: 1 });
  assert.deepEqual(parse('list 3'), { action: 'list', page: 3 });
  assert.deepEqual(parse('info 123456789012345678'), { action: 'info', target: '123456789012345678' });
  assert.equal(parse('remove').target, '');
  const reason = blacklist.checkReason;
  assert.deepEqual(reason(''), { ok: false, error: 'missing' });
  assert.deepEqual(reason('    '), { ok: false, error: 'missing' });
  assert.equal(reason('abcd').error, 'short');
  assert.equal(reason('abcde').ok, true);
  assert.equal(reason('a'.repeat(500)).ok, true);
  assert.equal(reason('a'.repeat(501)).error, 'long');
  assert.equal(reason('\u0007\u0007ab cd\u0000').reason, 'ab cd', 'control characters are dropped');
  assert.equal(reason('ééééé').ok, true, 'characters, not bytes');
  assert.equal(blacklist.LIMITS.reasonMin, 5);
  assert.equal(blacklist.LIMITS.reasonMax, 500);

  // ============================================================================================== hidden everywhere
  const command = cmd('blacklist');
  const team = cmd('team');
  for (const each of [command, team]) {
    assert.ok(each, 'the command is loaded');
    assert.ok(each.prefixOnly && each.hiddenEverywhere && each.hiddenFromHelp && each.teamOnly, `${each.data.name}: prefix only, hidden everywhere, hidden from help, team only`);
    assert.equal(isHiddenEverywhere(each), true);
    assert.ok(!collectCommandData().some((json) => json.name === each.data.name), `${each.data.name} is never registered with Discord`);
    assert.ok(!client.commands.has(`${each.data.name}config`), `${each.data.name} has no generated config card`);
  }
  assert.deepEqual(team.aliases, ['teamhelp']);
  for (const includeHidden of [false, true]) {
    const main = JSON.stringify(JSON.parse(JSON.stringify(help.mainView(client, { name: 'Test', members: { me: null } }, '!', includeHidden, 'en'))));
    for (const word of ['blacklist', 'teamhelp']) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(main), `!help does not list ${word} (includeHidden=${includeHidden})`);
    assert.ok(!/"value":"team"/.test(main), '!help does not list team');
    for (const typed of ['blacklist', 'black', 'blacklis', 'team', 'teamh', 'teamhelp', 'bl']) {
      assert.ok(!help.helpChoices(client, typed, includeHidden).some((choice) => /^(blacklist|team|teamhelp)( |$)/.test(choice.value)), `the autocomplete of /help does not offer ${typed} (includeHidden=${includeHidden})`);
      assert.ok(!help.suggestCommands(client, typed, includeHidden).some((name) => ['blacklist', 'team', 'teamhelp'].includes(name)), `"did you mean" for ${typed} does not suggest it (includeHidden=${includeHidden})`);
    }
    assert.ok(!help.helpChoices(client, '', includeHidden).some((choice) => /^(blacklist|team)/.test(choice.value)));
  }
  for (const typed of ['blacklist', 'team', 'teamhelp', 'blacklist add']) {
    const answers = [];
    const interaction = { client, user: { id: DEV }, guild: { id: '5550', name: 'Test', members: { me: null } }, pettoLang: 'en', options: { getString: () => typed }, reply: async (payload) => { answers.push(payload); return { createMessageComponentCollector: () => ({ on() {} }) }; }, editReply: async (payload) => { answers.push(payload); }, deferReply: async () => {}, isChatInputCommand: () => true };
    await cmd('help').execute(interaction, client).catch(() => {});
    for (const answer of answers) assert.ok(!/!blacklist <server|`!blacklist`/.test(JSON.stringify(JSON.parse(JSON.stringify(answer)))), `!help ${typed} does not show the command, not even to the team`);
  }
  assert.ok(!Object.values(SHORT_ALIAS_TABLE).some((target) => ['blacklist', 'team'].includes(target.split(' ')[0])) && !('blacklist' in SHORT_ALIAS_TABLE) && !('team' in SHORT_ALIAS_TABLE), 'the tables of short aliases have no word for it');
  const info = generator.loadCommandInfo();
  for (const name of ['blacklist', 'team']) {
    const entry = info.commands.find((each) => each.name === name);
    assert.ok(entry && entry.hiddenEverywhere === true && entry.hidden === true, `the catalog of the website and the generator read ${name} as hidden everywhere`);
  }
  const generated = generator.generate({ ...info, table: {} }).added;
  assert.ok(!Object.values(generated).some((target) => /^(blacklist|team)\b/.test(target)), 'the generator gives it no short word');
  assert.equal(isHiddenWordFor(client, 'blacklist', ANA), true);
  assert.equal(isHiddenWordFor(client, 'teamhelp', ANA), true);
  assert.equal(isHiddenWordFor(client, 'blacklist', DEV), false);
  assert.equal(isHiddenWordFor(client, 'ban', ANA), false);

  // ============================================================================================== nobody outside the team gets any reply
  const WORDS = [
    '!blacklist', `!blacklist ${G(1)} breaking the rules`, '!blacklist list', `!blacklist remove ${G(1)}`, `!blacklist info ${G(1)}`, '!BLACKLIST list', '! blacklist list', 'petto blacklist list',
    `petto blacklist ${G(1)} breaking the rules`, '<@123> blacklist list', '!team', '!teamhelp', 'petto team', '!TEAM',
    '!slots', '!botstatus', '!botstatus online', `!leaveguild ${G(1)}`, '!leaveguild --here', `!guildsend ${G(1)} policy`, 'petto slots', 'petto leaveguild --here',
  ];
  reset();
  for (const [who, perms] of [[ANA, 0n], [ADMIN, PermissionFlagsBits.Administrator], [SPY, PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageMessages]]) {
    for (const word of WORDS) {
      const result = await send(word, { as: who, perms });
      assert.deepEqual(result.sent, [], `\`${word}\` typed by a ${perms === 0n ? 'member' : 'member with permissions'} gets no reply at all`);
      assert.equal(result.typed, false, `\`${word}\` does not even show "typing"`);
      assert.equal(result.isCommand, false, `\`${word}\` is not a command for the other features`);
    }
  }
  assert.deepEqual(order, [], 'and nothing happened');
  assert.equal(table.size, 0);
  for (const each of [command, team, cmd('leaveguild'), cmd('guildsend'), cmd('slots'), cmd('botstatus')]) {
    const replies = [];
    const result = await each.execute({ user: { id: ANA }, client, guild: { id: '1' }, options: { getString: () => null, getSubcommand: () => null }, reply: async (p) => replies.push(p), editReply: async (p) => replies.push(p), deferReply: async () => {} });
    assert.ok(result === undefined && replies.length === 0, `${each.data.name} called directly by a member says nothing (the second lock)`);
  }
  assert.equal((await send('!zzzzzz')).sent.length, 1, 'any other unknown word is still answered');
  assert.equal((await send('!ping')).isCommand, true);

  // ============================================================================================== !blacklist add, with Petto inside
  reset();
  const bad = makeGuild(1, { name: 'Bad Server', locale: 'en-US', members: 345 });
  const spanish = makeGuild(2, { name: 'Servidor Malo', locale: 'es-ES' });
  const portuguese = makeGuild(3, { name: 'Servidor Ruim', locale: 'pt-BR' });
  makeGuild(4, { name: 'Twin' });
  makeGuild(5, { name: 'Twin' });
  makeGuild(6, { name: 'Good Server' });
  const ok = await send(`!blacklist ${bad.id} breaking the terms: scam @everyone <@${ANA}> http://evil.example`, { as: DEV });
  assert.equal(ok.sent.length, 1);
  assert.ok(/Blacklisted/.test(ok.sent[0]) && ok.sent[0].includes(bad.id) && ok.sent[0].includes('Bad Server') && ok.sent[0].includes('345 members'), 'the team sees the name, the id and the members');
  assert.ok(/direct message/.test(ok.sent[0]) && /left/.test(ok.sent[0]), 'and what Petto did');
  const at = (what) => order.indexOf(what);
  assert.ok(at('db:insert') >= 0 && at('db:insert') < at('notice:dm') && at('notice:dm') < at('leave') && at('leave') < at('ops'), `saved first, then the notice, then the leaving, then the note for the team (${order.join(' > ')})`);
  assert.deepEqual(leaves, [bad.id]);
  assert.equal(store.isBlacklisted(bad.id), true, 'the entry is in memory at once');
  const row = table.get(bad.id);
  assert.ok(row.added_by === DEV && row.guild_name === 'Bad Server' && row.owner_id === bad.ownerId && row.reason.startsWith('breaking the terms') && row.notified_at && row.left_at, 'the row says who, which server, why, the owner, when it was told and when Petto left');
  assert.equal(dms.length, 1);
  assert.equal(dms[0].to, bad.ownerId, 'the notice goes to the owner of the server');
  const card = text(dms[0].payload);
  for (const wanted of ['Petto left this server', 'blacklisted for breaking Petto', 'terms of service or privacy policy', 'Reason', 'breaking the terms: scam', links.SUPPORT_URL, 'https://petto.sbs/terms', 'https://petto.sbs/privacy', 'Bad Server', bad.id, 'contact support']) assert.ok(card.includes(wanted), `the notice says ${wanted}`);
  assert.ok(card.includes('@\\u200beveryone') || card.includes('@\u200beveryone'), '@everyone is made harmless in the reason');
  assert.ok(!card.includes('https://evil') && !card.includes('http://evil'), 'a link in the reason is not clickable');
  assert.deepEqual(dms[0].payload.allowedMentions, { parse: [] }, 'the notice pings nobody');
  assert.ok(!/From Bad Server|dminfo|dmrep/.test(card), 'it does not say it comes from the server');
  assert.equal(opsPosts.length, 1);
  for (const wanted of ['Bad Server', bad.id, bad.ownerId, '345', 'breaking the terms', DEV]) assert.ok(opsPosts[0].includes(wanted), `the note for the team has ${wanted}`);
  // the language of the server
  reset();
  await send(`!blacklist ${spanish.id} incumplir los términos`, { as: DEV });
  assert.ok(text(dms[0].payload).includes('Petto salió de este servidor') && text(dms[0].payload).includes('https://petto.sbs/es/terms') && text(dms[0].payload).includes('https://petto.sbs/es/privacy'), 'Spanish for a Spanish server, with the Spanish pages');
  reset();
  await send(`!blacklist ${portuguese.id} violar os termos`, { as: DEV });
  assert.ok(text(dms[0].payload).includes('O Petto saiu deste servidor') && text(dms[0].payload).includes('https://petto.sbs/pt-br/terms'), 'Portuguese for a Portuguese server');
  for (const lang of ['en', 'es', 'pt-BR']) {
    const rendered = text(blacklist.noticeCard({ lang, guildName: 'X', guildId: G(1), reason: 'because it broke the rules' }));
    assert.ok(rendered.includes('because it broke the rules') && rendered.includes(links.SUPPORT_URL) && !/\{[a-z]+\}/.test(rendered), `${lang}: the card is complete`);
    assert.ok(i18n.t(lang, 'blacklist.unavailable').length > 5);
  }
  // an owner who cannot be written to: the system channel, else the first channel Petto can write in; with none, nothing is sent and the leaving still happens
  reset();
  const closedA = makeGuild(7, { name: 'Closed A', system: 'system' });
  closedDms.add(closedA.ownerId);
  const resultA = await send(`!blacklist ${closedA.id} spam and scams here`, { as: DEV });
  assert.equal(channelSends.length, 1, 'one notice, in the channel');
  assert.ok(/channel of the server/.test(resultA.sent[0]) && leaves.includes(closedA.id));
  assert.ok(text(channelSends[0].payload).includes('Petto left this server'));
  reset();
  const closedB = makeGuild(8, { name: 'Closed B' });
  closedDms.add(closedB.ownerId);
  await send(`!blacklist ${closedB.id} spam and scams here`, { as: DEV });
  assert.equal(channelSends.length, 1, 'with no system channel, the first channel Petto can write in');
  reset();
  const closedC = makeGuild(9, { name: 'Closed C', system: 'none' });
  closedDms.add(closedC.ownerId);
  const resultC = await send(`!blacklist ${closedC.id} spam and scams here`, { as: DEV });
  assert.ok(channelSends.length === 0 && dms.length === 0 && leaves.includes(closedC.id) && /could NOT be told/.test(resultC.sent[0]), 'no way to tell them: Petto still leaves, and the team is told');

  // the name lookup, and the refusals
  reset();
  const named = await send('!blacklist "Good Server" is breaking the rules', { as: DEV });
  assert.ok(leaves.includes(G(6)) && /Good Server/.test(named.sent[0]), 'a quoted name of a server Petto is in');
  makeGuild(10, { name: 'Two Words Server' });
  reset();
  await send('!blacklist Two Words Server breaking the rules', { as: DEV });
  assert.ok(leaves.includes(G(10)), 'an unquoted name with spaces');
  reset();
  const twin = await send('!blacklist Twin breaking the rules', { as: DEV });
  assert.ok(/2 servers/.test(twin.sent[0]) && leaves.length === 0 && !store.isBlacklisted(G(4)), 'two servers with the same name: it asks for the ID and does nothing');
  const sizeBefore = table.size;
  const unknown = await send('!blacklist "No Such Server" breaking the rules', { as: DEV });
  assert.ok(/no server called/.test(unknown.sent[0]) && table.size === sizeBefore, 'an unknown name is refused');
  for (const [textTyped, why] of [[`${G(11)} abcd`, /too short/], [`${G(11)}`, /reason is required/], [`${G(11)} ${'a'.repeat(501)}`, /too long/]]) {
    const refused = await send(`!blacklist ${textTyped}`, { as: DEV });
    assert.ok(why.test(refused.sent[0]) && !store.isBlacklisted(G(11)), `refused: ${why}`);
  }
  const insertsBefore = order.filter((entry) => entry === 'db:insert').length;
  await send(`!blacklist ${G(11)} abcd`, { as: DEV });
  assert.equal(order.filter((entry) => entry === 'db:insert').length, insertsBefore, 'a refused reason stores nothing');
  assert.equal((await send(`!blacklist ${G(12)} abcde`, { as: DEV })).sent[0].includes('Blacklisted'), true, 'exactly 5 characters are accepted');
  assert.equal((await send(`!blacklist ${G(13)} ${'b'.repeat(500)}`, { as: DEV })).sent[0].includes('Blacklisted'), true, 'exactly 500 characters are accepted');
  assert.ok(/not in that server/.test((await send(`!blacklist ${G(14)} not inside right now`, { as: DEV })).sent[0]), 'a server Petto is not in is stored; Petto has nothing to leave');
  assert.ok(store.isBlacklisted(G(14)) && !leaves.includes(G(14)));
  assert.ok(/already blacklisted/.test((await send(`!blacklist ${G(14)} not inside right now`, { as: DEV })).sent[0]), 'adding it again says so');
  assert.ok(/operations or support server/.test((await send(`!blacklist ${SUPPORT} nice try with this one`, { as: DEV })).sent[0]) && !store.isBlacklisted(SUPPORT), 'the support server cannot be blacklisted');
  const owner = await send(`!blacklist ${G(15)} the owner may do it too`, { as: config.ownerId });
  assert.ok(/Blacklisted/.test(owner.sent[0]), 'the owner is the team');

  // ============================================================================================== list, info, remove
  const listPage = await send('!blacklist list', { as: DEV });
  assert.ok(/Blacklisted servers \(\d+\)/.test(listPage.sent[0]) && /Page 1 of 2/.test(listPage.sent[0]), 'the list is paged (8 to a page)');
  const entriesNow = store.entries().length;
  assert.ok(entriesNow > 8, `${entriesNow} entries`);
  assert.ok(/Page 2 of 2/.test((await send('!blacklist list 2', { as: DEV })).sent[0]));
  assert.ok(/Blacklisted servers/.test((await send('petto blacklist list', { as: DEV })).sent[0]), '`petto blacklist list` works for the team too');
  assert.ok(/Blacklisted servers/.test((await send('<@123> blacklist list', { as: DEV })).sent[0]), 'and with a mention');
  assert.ok(/Blacklist/.test((await send('!blacklist', { as: DEV })).sent[0]), 'alone it shows how to use it');
  assert.ok(/Page 2 of 2/.test((await send('!blacklist list 99', { as: DEV })).sent[0]), 'a page too far is the last one');
  const allLines = (await send('!blacklist list', { as: DEV })).sent[0] + (await send('!blacklist list 2', { as: DEV })).sent[0];
  assert.ok(allLines.includes('Bad Server') && allLines.includes(DEV) && /Petto is not in it/.test(allLines) && /by /.test(allLines) && /\\u003ct:|<t:/.test(allLines.replace(/\\u003c/g, '<')), 'each line has the name, who added it, when and whether Petto is still in it');
  assert.ok(/Listed by the host|host/.test(allLines), 'the entry of the environment is marked');
  const one = await send(`!blacklist info ${bad.id}`, { as: DEV });
  for (const wanted of ['Bad Server', 'breaking the terms', DEV, bad.ownerId, 'Owner told', 'Attempts to add Petto again', 'Petto is not in it']) assert.ok(one.sent[0].includes(wanted), `info has ${wanted}`);
  assert.ok(/not on the blacklist/.test((await send(`!blacklist info ${G(40)}`, { as: DEV })).sent[0]));
  assert.ok(/Bad Server/.test((await send('!blacklist info "Bad Server"', { as: DEV })).sent[0]), 'info by the name it had');
  assert.ok(/listed by the host/.test((await send(`!blacklist remove ${ENV_ID}`, { as: DEV })).sent[0]) && store.isBlacklisted(ENV_ID), 'an id of the environment cannot be removed from here');

  // unblacklist: the server may add Petto again and it stays
  reset();
  const removed = await send(`!blacklist remove ${bad.id}`, { as: DEV });
  assert.ok(/off the blacklist/.test(removed.sent[0]) && !store.isBlacklisted(bad.id) && !table.has(bad.id));
  assert.ok(opsPosts.length === 1 && /taken off/.test(opsPosts[0]) && opsPosts[0].includes(DEV), 'the team channel has a note about it');
  assert.ok(/not on the blacklist/.test((await send(`!blacklist remove ${bad.id}`, { as: DEV })).sent[0]));
  reset();
  const back = makeGuild(1, { name: 'Bad Server', members: 345 });
  assert.equal(blacklist.blocksEvent({ name: 'guildCreate' }, [back]), false, 'after `remove` the other listeners run again');
  assert.equal(await blacklist.handleJoin(client, back), false);
  assert.deepEqual([leaves.length, dms.length, opsPosts.length], [0, 0, 0], 'after `remove` a later add stays: Petto does not leave');

  // ============================================================================================== a blacklisted server adds Petto: leave FIRST, nothing else
  const eventsDir = path.join(root, 'src/events');
  const createListeners = fs.readdirSync(eventsDir).filter((file) => file.startsWith('guildCreate') && file.endsWith('.js')).sort();
  assert.ok(createListeners.includes('guildCreate.js') && createListeners.includes('guildCreateInviteCache.js') && createListeners.includes('guildCreateBlacklist.js'));
  const invokers = createListeners.map((file) => makeInvoker(require(path.join(eventsDir, file)), file, client));
  const exempt = createListeners.filter((file) => require(path.join(eventsDir, file)).blacklistExempt);
  assert.deepEqual(exempt, ['guildCreateBlacklist.js'], 'only the blacklist listener runs for a blacklisted server');
  const sweepGuild = makeGuild(20, { name: 'Re-add Server' });
  guilds.delete(sweepGuild.id);
  await store.add({ guildId: sweepGuild.id, reason: 'breaking our terms of service', addedBy: DEV, guildName: 'Re-add Server', ownerId: sweepGuild.ownerId });
  const joinNow = async (guild) => { guilds.set(guild.id, guild); order.length = 0; for (const invoke of invokers) invoke(guild); await settle(); };
  reset();
  await joinNow(sweepGuild);
  assert.equal(order[0], 'leave', `Petto leaves FIRST (${order.join(' > ')})`);
  assert.deepEqual(order.filter((entry) => entry.startsWith('side:')), [], 'no other listener ran: no write, no setup, no invite cache, no lifecycle log, no owner or audit lookup');
  assert.ok(order.indexOf('leave') < order.indexOf('db:attempt') && order.indexOf('db:attempt') < order.indexOf('notice:dm') && order.indexOf('notice:dm') < order.indexOf('ops'), `then the attempt, the notice and the note (${order.join(' > ')})`);
  assert.equal(table.get(sweepGuild.id).attempts, 1, 'the attempt is counted');
  assert.ok(table.get(sweepGuild.id).last_attempt_at && table.get(sweepGuild.id).notified_at);
  assert.equal(dms.length, 1);
  assert.equal(dms[0].to, sweepGuild.ownerId, 'the owner is told');
  assert.ok(text(dms[0].payload).includes('breaking our terms of service') && text(dms[0].payload).includes('Petto left this server'));
  assert.equal(opsPosts.length, 1);
  assert.ok(/tried to add Petto/.test(opsPosts[0]) && opsPosts[0].includes('Re-add Server') && opsPosts[0].includes(sweepGuild.id) && opsPosts[0].includes(sweepGuild.ownerId) && /Attempts: 1/.test(opsPosts[0]) && opsPosts[0].includes('breaking our terms'), 'one line for the team: name, id, owner, attempts, reason');
  // again within a day: leaves again, counts, but no second notice and no second line
  await joinNow(sweepGuild);
  assert.equal(order[0], 'leave');
  assert.equal(table.get(sweepGuild.id).attempts, 2, 'the second attempt is counted');
  assert.equal(dms.length, 1, 'ONE notice for each server in 24 hours');
  assert.equal(opsPosts.length, 1, 'and the note for the team is limited for the same server');
  assert.equal(leaves.length, 2);
  for (let i = 0; i < 5; i += 1) await joinNow(sweepGuild);
  assert.ok(dms.length === 1 && opsPosts.length === 1 && table.get(sweepGuild.id).attempts === 7, 'a loop of 5 more re-adds: still one notice, one line, and every attempt counted');
  // after 24 hours the owner is told again
  table.get(sweepGuild.id).notified_at = new Date(Date.now() - 25 * 3600_000);
  await joinNow(sweepGuild);
  assert.equal(dms.length, 2, 'after 24 hours, one more notice');
  // other servers in a loop cannot flood the team channel: 5 lines a minute at most
  reset();
  for (let i = 0; i < 8; i += 1) {
    const flood = makeGuild(30 + i, { name: `Flood ${i}` });
    guilds.delete(flood.id);
    await store.add({ guildId: flood.id, reason: 'flooding the bot with adds', addedBy: DEV });
    await joinNow(flood);
  }
  assert.equal(opsPosts.length, blacklist.LIMITS.opsBurst, `at most ${blacklist.LIMITS.opsBurst} lines a minute in the team channel for 8 servers`);
  assert.equal(leaves.length, 8, 'but every one of them was left');
  assert.equal(dms.length, 8, 'and each owner was told once');
  // a server that is not blacklisted is not touched by any of this
  reset();
  const fine = makeGuild(60, { name: 'Fine' });
  assert.equal(blacklist.blocksEvent({ name: 'guildCreate' }, [fine]), false);
  assert.equal(await blacklist.handleJoin(client, fine), false);
  assert.deepEqual([leaves.length, order.length], [0, 0]);
  // the real guildCreate of a server that is NOT blacklisted still runs (and it is the blacklisted case that never reaches it)
  await joinNow(fine);
  assert.ok(order.includes('side:createGuildIfMissing') && order.includes('side:inviteCache'), 'for a normal server the usual listeners run');
  assert.deepEqual(leaves, []);

  // ============================================================================================== the other doors
  reset();
  const calls = [];
  const spy = (name, exemptFlag = false) => makeInvoker({ name, blacklistExempt: exemptFlag, execute: async (...args) => { calls.push(name); return args; } }, `${name}.js`, client);
  const badId = sweepGuild.id;
  const goodId = G(60);
  const answers = [];
  const interactionOf = (guildId) => ({ guildId, guild: { id: guildId, preferredLocale: 'es-ES' }, isAutocomplete: () => false, replied: false, deferred: false, reply: async (payload) => { answers.push(payload); } });
  const doors = [
    ['messageCreate', (id) => [{ guildId: id, guild: { id }, author: { bot: false }, content: '!ping' }]],
    ['interactionCreate', (id) => [interactionOf(id)]],
    ['guildMemberAdd', (id) => [{ guild: { id }, guildId: id, user: { id: ANA } }]],
    ['messageReactionAdd', (id) => [{ message: { guildId: id } }, { id: ANA }]],
    ['guildAuditLogEntryCreate', (id) => [{ target: {} }, Object.assign(Object.create({ constructor: { name: 'Guild' } }), { id })]],
    ['voiceStateUpdate', (id) => [{ guild: { id } }, { guild: { id } }]],
    ['channelCreate', (id) => [{ guild: { id }, guildId: id }]],
  ];
  for (const [name, make] of doors) {
    calls.length = 0;
    spy(name)(...make(badId));
    spy(name)(...make(badId));
    await settle();
    assert.deepEqual(calls, [], `${name}: a blacklisted server runs no listener`);
    spy(name)(...make(goodId));
    await settle();
    assert.deepEqual(calls, [name], `${name}: any other server runs them as before`);
  }
  const shared = interactionOf(badId);
  answers.length = 0;
  spy('interactionCreate')(shared); spy('interactionCreate')(shared); spy('interactionCreate')(shared);
  await settle();
  assert.equal(answers.length, 1, 'three listeners, one answer');
  assert.ok(/no está disponible/.test(answers[0].content) && answers[0].flags === MessageFlags.Ephemeral, 'private, and in the language of the server');
  calls.length = 0;
  spy('guildDelete', true)(sweepGuild);
  spy('guildCreate', true)(sweepGuild);
  await settle();
  assert.deepEqual(calls, ['guildDelete', 'guildCreate'], 'the listeners marked as exempt do run');
  assert.ok(read('src/events/guildDelete.js').includes('blacklistExempt: true') && read('src/events/guildCreateBlacklist.js').includes('blacklistExempt: true'));
  // the web routes
  const express = require('express');
  const app = express();
  blacklist.guardWebGuild(app);
  app.get('/api/dashboard/guild/:guildId/thing', (req, res) => res.json({ ok: true }));
  app.get('/transcript/:guildId/:number/:token', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = async (url) => { const response = await fetch(`${base}${url}`); return { status: response.status, body: await response.json() }; };
  assert.deepEqual(await ask(`/api/dashboard/guild/${badId}/thing`), { status: 404, body: { ok: false, error: 'guild_unavailable' } }, 'the dashboard API says "not available" for a blacklisted server');
  assert.equal((await ask(`/transcript/${badId}/1/abc`)).status, 404, 'and so do the transcripts');
  assert.deepEqual(await ask(`/api/dashboard/guild/${goodId}/thing`), { status: 200, body: { ok: true } }, 'any other server is served');
  await blacklist.unblacklistGuild(badId);
  assert.equal((await ask(`/api/dashboard/guild/${badId}/thing`)).status, 200, 'and after `remove` the routes work again');
  await new Promise((resolve) => server.close(resolve));
  assert.ok(/guardWebGuild\(app\)/.test(read('src/web/server.js')), 'the real server installs the guard');
  assert.ok(/guildBlacklist\.blocksEvent/.test(read('src/handlers/eventHandler.js')), 'the loader of events asks the blacklist first');

  // ============================================================================================== the sweep at ready
  reset();
  await store.add({ guildId: G(70), reason: 'found at the start', addedBy: DEV });
  await store.add({ guildId: G(71), reason: 'found at the start', addedBy: DEV });
  await store.add({ guildId: G(72), reason: 'found at the start', addedBy: DEV });
  for (const n of [70, 71, 72, 73, 74]) makeGuild(n);
  const sleeps = [];
  const dealt = await blacklist.sweep(client, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(dealt, 3);
  assert.deepEqual(leaves.filter((id) => [G(70), G(71), G(72)].includes(id)), [G(70), G(71), G(72)], 'every blacklisted server that Petto was in is left');
  assert.ok(guilds.has(G(73)) && guilds.has(G(74)), 'the others stay');
  assert.deepEqual(sleeps, [1000, 1000], 'one every second, never all at once');
  assert.equal(dms.filter((entry) => [G(70), G(71), G(72)].map((id) => guilds.get(id)?.ownerId ?? `70000000000000${id.slice(-4)}`).includes(entry.to)).length, 3, 'each owner is told once');
  assert.ok(opsPosts.length >= 1 && /found at start/.test(opsPosts[0]));
  const ready = read('src/events/ready.js');
  assert.ok(/guildBlacklist\.sweep\(client\)/.test(ready), 'the ready event runs the sweep');
  const main = read('index.js');
  assert.ok(main.indexOf("guildBlacklist').load()") > main.indexOf('await runMigrations()') && main.indexOf("guildBlacklist').load()") < main.indexOf('await client.login'), 'the list is loaded before the login');

  // ============================================================================================== !team: read from the commands, so it cannot go stale
  reset();
  const listed = await send('!team', { as: DEV });
  const everything = listed.sent.join('\n');
  const flagged = [...client.commands.values()].filter((each) => each.teamOnly);
  assert.ok(flagged.length >= 7, `${flagged.length} commands are flagged as team only`);
  for (const each of flagged) {
    assert.ok(each.team && each.team.summary && each.team.usage?.length && each.team.who, `${each.data.name} carries its description, usage and who may use it`);
    assert.ok(everything.includes(each.data.name) && each.team.usage.every((line) => everything.includes(line.slice(0, 20))), `!team lists ${each.data.name} with its usage`);
  }
  for (const name of ['slots', 'botstatus', 'guildsend', 'leaveguild', 'guilddebug', 'blacklist', 'team']) assert.ok(flagged.some((each) => each.data.name === name), `${name} is a flagged team tool`);
  for (const each of flagged) assert.ok(each.teamOnly && isTeamOnly(each), `${each.data.name} is silent for everybody outside the team`);
  assert.ok(!/music/i.test(everything), 'the music is not mentioned');
  assert.ok(/teamhelp/.test(everything) && /premium grant/.test(everything) && /am <control token>/.test(everything), 'the parts of other commands are listed too (and the token never is)');
  assert.ok(/owner only/.test(everything));
  for (const piece of cmd('team').teamText(client)) assert.ok(piece.length <= 3000, 'each piece fits in one message');
  const viaWord = await send('petto teamhelp', { as: DEV });
  assert.ok(viaWord.sent.length >= 1 && viaWord.sent.join('').includes('leaveguild'), '`petto teamhelp` works for the team');
  // a new tool shows up as soon as it carries its metadata
  client.commands.set('zzfake', { data: { name: 'zzfake' }, teamOnly: true, team: { summary: 'A tool added later.', usage: ['!zzfake'], who: 'owner' } });
  assert.ok(cmd('team').teamText(client).join('\n').includes('zzfake'), 'it is generated, not written by hand');
  client.commands.delete('zzfake');

  // ============================================================================================== !leaveguild
  reset();
  const target = makeGuild(80, { name: 'Leave Me', members: 12, ownerId: '700000000000009999' });
  makeGuild(81, { name: 'Pair' }); makeGuild(82, { name: 'Pair' });
  const home = makeGuild(83, { name: 'Home Server' });
  const typed = (word, who = DEV, guild = null) => send(word, { as: who, guild });
  let result = await typed(`!leaveguild ${target.id}`);
  assert.ok(/Leave Me/.test(result.sent[0]) && result.sent[0].includes(target.id) && /12 members/.test(result.sent[0]) && result.sent[0].includes('700000000000009999'), 'it shows the name, the id, the members and the owner before it leaves');
  assert.ok(result.sent[0].includes('teamyes:') && result.sent[0].includes('teamno:'), 'with yes and no buttons');
  assert.deepEqual(leaves, [], 'nobody answered: it did not leave');
  assert.ok(result.sent.some((entry) => /Nobody answered in 30 seconds/.test(entry)), 'and it says that nothing was done');
  clickLog = {};
  scriptedClicks = [{ user: ANA, which: 'yes' }, { user: DEV, which: 'no' }];
  result = await typed(`!leaveguild ${target.id}`);
  assert.deepEqual(clickLog.tried, [ANA, DEV], 'a stranger pressing yes is ignored: only the author can answer');
  assert.equal(clickLog.time, 30_000, 'the question expires in 30 seconds');
  assert.deepEqual(leaves, [], 'no means no');
  assert.ok(/Cancelled/.test(clickLog.updated));
  clickLog = {};
  scriptedClicks = [{ user: ANA, which: 'yes' }, { user: DEV, which: 'yes' }];
  opsPosts.length = 0;
  result = await typed(`!leaveguild ${target.id}`);
  assert.deepEqual(leaves, [target.id], 'yes, from the author, and Petto leaves');
  assert.ok(opsPosts.length === 1 && opsPosts[0].includes('Leave Me') && opsPosts[0].includes(target.id) && opsPosts[0].includes(DEV), 'the team channel has a note with who did it');
  assert.ok(result.sent.some((entry) => /Petto left/.test(entry) && entry.includes('Leave Me')), 'and the reply says what it did');
  // by name, unique; two with the same name; unknown; an id Petto is not in
  reset();
  scriptedClicks = [{ user: DEV, which: 'yes' }];
  makeGuild(84, { name: 'By Name' });
  await typed('!leaveguild By Name');
  assert.deepEqual(leaves, [G(84)], 'a name that only one server has');
  reset();
  assert.ok(/2 servers/.test((await typed('!leaveguild Pair')).sent[0]) && leaves.length === 0, 'two servers with that name: use the ID');
  assert.ok(/no server called/.test((await typed('!leaveguild Nope Nope')).sent[0]));
  assert.ok(/not currently in a server/.test((await typed(`!leaveguild ${G(99)}`)).sent[0]), 'an ID Petto is not in');
  assert.ok(/Say which server/.test((await typed('!leaveguild')).sent[0]));
  // the server where it is typed: refused unless --here
  scriptedClicks = [{ user: DEV, which: 'yes' }];
  const hereRefused = await typed(`!leaveguild ${home.id}`, DEV, home);
  assert.ok(/typed the command/.test(hereRefused.sent[0]) && leaves.length === 0, 'the server where the command is typed is refused');
  assert.ok(/typed the command/.test((await typed('!leaveguild here', DEV, home)).sent[0]) && leaves.length === 0, '`here` is the current server: the same refusal without --here');
  reset();
  scriptedClicks = [{ user: DEV, which: 'yes' }];
  await typed('!leaveguild --here', DEV, home);
  assert.deepEqual(leaves, [home.id], 'with --here, after the confirmation, it leaves this server');
  // the operations and support server are never left
  reset();
  const support = makeGuild(85, { name: 'Support' });
  support.id = SUPPORT; guilds.set(SUPPORT, support);
  scriptedClicks = [{ user: DEV, which: 'yes' }];
  assert.ok(/operations or support server/.test((await typed(`!leaveguild ${SUPPORT}`)).sent[0]) && leaves.length === 0);
  assert.ok(/operations or support server/.test((await typed('!leaveguild --here', DEV, support)).sent[0]) && leaves.length === 0, 'not even with --here');
  guilds.delete(SUPPORT);
  // it works from any server now (it used to work only in the operations server), because it asks first
  assert.ok(!/resolveOpsGuildId\(interaction\.client\)/.test(read('src/commands/utility/leaveguild.js')), 'no restriction to one server: the confirmation is the safety');

  // ============================================================================================== !guildsend
  reset();
  const notified = makeGuild(90, { name: 'Notice Me', members: 77, ownerId: '700000000000008888' });
  noticeCalls.length = 0;
  let sent = await typed(`!guildsend ${notified.id} policy We saw a problem`);
  assert.equal(noticeCalls.length, 1);
  assert.deepEqual([noticeCalls[0].guildId, noticeCalls[0].kind, noticeCalls[0].details, noticeCalls[0].requestedBy], [notified.id, 'policy', 'We saw a problem', DEV]);
  assert.ok(/Notice Me/.test(sent.sent[0]) && sent.sent[0].includes(notified.id) && /77 members/.test(sent.sent[0]) && sent.sent[0].includes('700000000000008888') && /DM to the server owner/.test(sent.sent[0]), 'it shows what it did: name, id, members, owner and where it went');
  assert.ok(opsPosts.length === 1 && opsPosts[0].includes('Notice Me') && opsPosts[0].includes(DEV) && /policy/.test(opsPosts[0]), 'and logs it to the team channel');
  noticeCalls.length = 0;
  await typed('!guildsend "Notice Me" logs');
  assert.equal(noticeCalls[0]?.guildId, notified.id, 'by a unique name');
  noticeCalls.length = 0;
  await typed('!guildsend here maintenance', DEV, notified);
  assert.equal(noticeCalls[0]?.guildId, notified.id, 'or the current server');
  noticeCalls.length = 0;
  assert.ok(/Unknown type/.test((await typed(`!guildsend ${notified.id} nonsense`)).sent[0]) && noticeCalls.length === 0);
  assert.ok(/not currently in a server/.test((await typed(`!guildsend ${G(99)} policy`)).sent[0]));
  assert.ok(/2 servers/.test((await typed('!guildsend Pair policy')).sent[0]) && noticeCalls.length === 0);
  noticeResult = () => ({ ok: false });
  assert.ok(/could not find a safe private route/.test((await typed(`!guildsend ${notified.id} policy`)).sent[0]), 'a failed delivery says so and never uses a public channel');
  noticeResult = () => ({ ok: true, deliveryType: 'owner_dm', channel: null });
  const opsAlerts = read('src/utils/guildOpsAlerts.js');
  assert.ok((opsAlerts.match(/allowedMentions: \{ parse: \[\] \}/g) ?? []).length >= 2, 'the notice goes out with no mentions, in a channel and in a DM');
  assert.ok(/never fall back to a random public channel/i.test(opsAlerts), 'and never to a public channel');

  // ============================================================================================== !guilddebug
  reset();
  const debugGuild = makeGuild(95, { name: 'Debug Me', members: 999 });
  await store.add({ guildId: debugGuild.id, reason: 'listed to test the debug', addedBy: DEV });
  const debug = cmd('guilddebug');
  const debugReplies = [];
  const debugInteraction = (userId) => ({
    user: { id: userId }, guildId: debug.privateGuildId, client, deferred: false, replied: false,
    options: { getSubcommand: () => 'info', getString: () => debugGuild.id },
    reply: async (payload) => { debugReplies.push(payload); }, deferReply: async function deferReply() { this.deferred = true; }, editReply: async (payload) => { debugReplies.push(payload); },
  });
  await debug.execute(debugInteraction(ANA));
  assert.ok(/unavailable here/.test(dump(debugReplies.at(-1))), 'a stranger is refused');
  debugReplies.length = 0;
  await debug.execute(debugInteraction(DEV));
  const shown = dump(debugReplies.at(-1)); if (process.env.DBG) console.log(shown);
  for (const wanted of ['Debug Me', debugGuild.id, '999', 'Shard', 'Petto joined', 'Premium', 'active', 'Blacklist', 'LISTED', 'listed to test the debug', 'Features', 'COMMUNITY', 'Petto in the server', 'Administrator', 'Owner']) assert.ok(shown.includes(wanted), `guilddebug info shows ${wanted}`);
  assert.ok(!shown.includes(config.token ?? 'check-only') && !/postgres:\/\//.test(shown) && !/secret|password/i.test(shown), 'and never a secret');

  console.log('check-guild-blacklist: ok');
})().catch((error) => { console.error(error); process.exit(1); });

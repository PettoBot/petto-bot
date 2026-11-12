// Checks the activity leaderboards: the day, week and month of Petto (GMT-5) and when each ends, the words of a card in the three languages, writing the three messages
// (the first time, the edits, a deleted one, the reasons a board cannot be written), who may be in a top, the job that goes through the boards that are due (in batches, within a
// budget of writes to Discord, so thousands of boards keep their turn without filling the queue in front of Discord), the SQL of the one-trip read and of the batch save, and the command.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
// The pool is replaced before the database module is loaded, so its own queries can be read (what the SQL asks for) without a database.
const postgres = require('../src/db/postgres');
const queries = [];
let nextRows = [];
postgres.getPrimaryPool = () => ({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: nextRows }; } });
const i18n = require('../src/i18n');
const db = require('../src/db/activityLeaderboards');
const realReadTops = db.readTops;
const realFlush = db.flushRefreshed;
const statsRules = require('../src/db/statsRules');
const board = require('../src/utils/activityLeaderboard');
const command = require('../src/commands/info/activityboard.js');
const config = require('../src/config');
const logger = require('../src/utils/logger');

const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
i18n.setCachedGuildLanguage(GUILD, 'en');
const text = (payload) => JSON.stringify(payload.components[0].toJSON());
const HOUR = 3_600_000;

(async () => {
  // ---- the periods: GMT-5, ISO weeks from Monday
  const at = new Date('2026-11-12T03:00:00Z'); // Wednesday 11 November, 22:00 in Colombia
  const daily = board.periodWindow('daily', at);
  assert.deepEqual([daily.startDay, daily.resetAt.toISOString()], ['2026-11-11', '2026-11-12T05:00:00.000Z'], 'the day is the one of Colombia and ends at its midnight');
  const weekly = board.periodWindow('weekly', at);
  assert.deepEqual([weekly.startDay, weekly.resetAt.toISOString()], ['2026-11-09', '2026-11-16T05:00:00.000Z'], 'the week begins on Monday');
  const monthly = board.periodWindow('monthly', at);
  assert.deepEqual([monthly.startDay, monthly.resetAt.toISOString()], ['2026-11-01', '2026-12-01T05:00:00.000Z']);
  assert.equal(board.periodWindow('weekly', new Date('2026-11-15T10:00:00Z')).startDay, '2026-11-09', 'Sunday belongs to the week that began on Monday');
  assert.equal(board.periodWindow('weekly', new Date('2026-11-09T05:30:00Z')).startDay, '2026-11-09', 'half an hour after midnight on Monday is the new week');
  assert.equal(board.periodWindow('weekly', new Date('2026-11-09T04:59:00Z')).startDay, '2026-11-02', 'a minute before it is still the last one');
  assert.equal(board.periodWindow('daily', new Date('2026-11-12T04:59:00Z')).startDay, '2026-11-11', 'the day of Colombia, not the one of UTC');
  assert.equal(board.periodWindow('monthly', new Date('2026-12-31T20:00:00Z')).resetAt.toISOString(), '2027-01-01T05:00:00.000Z', 'the month of December ends into the next year');
  assert.equal(board.periodWindow('monthly', new Date('2026-02-10T12:00:00Z')).resetAt.toISOString(), '2026-03-01T05:00:00.000Z', 'February is short');
  assert.deepEqual([...board.PERIODS], ['monthly', 'weekly', 'daily'], 'posted longest first, as they read');

  // ---- the words of a card
  const resetAt = new Date('2026-11-16T05:00:00Z');
  const chat = [{ username: 'racem1c', amount: 8372 }, ...Array.from({ length: 12 }, (_, index) => ({ username: `user${index + 2}`, amount: 7000 - index }))];
  const en = board.boardText('en', 'chat', 'daily', chat, resetAt);
  assert.ok(en.startsWith('**Chat Leaderboard [Daily]**'), 'the title');
  assert.ok(en.includes('**Most active chatter** `racem1c`') && en.includes('**8,372 messages**'), 'the most active member on its own line, with the number written for the language');
  assert.ok(en.includes('`user2`') && en.includes('`user10`') && !en.includes('`user11`'), 'ten places in all: the first and nine more');
  assert.ok(en.includes('pe_zz02:') && en.includes('pe_zz10:') && !en.includes('pe_zz01:'), 'the numbered rows have the pink numbers 2 to 10');
  assert.ok(en.includes(`<t:${Math.floor(resetAt.getTime() / 1000)}:R>`) && en.includes('-# Updates every 5 minutes!'), 'when it begins again, and how often it is updated');
  const voice = board.boardText('en', 'voice', 'weekly', [{ username: 'tal', amount: 3600 }, { username: 'mia', amount: 60 }], resetAt);
  assert.ok(voice.includes('Voice Leaderboard [Weekly]') && voice.includes('**Most active talker** `tal`') && voice.includes('**60 voice minutes**'), 'voice is shown in minutes');
  assert.ok(voice.includes('**1 voice minute**'), 'and in the singular');
  assert.ok(board.boardText('en', 'chat', 'daily', [{ username: 'a', amount: 1 }], resetAt).includes('**1 message**'), 'one message');
  assert.ok(board.boardText('en', 'chat', 'daily', [], resetAt).includes('Nobody has been active in this period yet.'), 'an empty card says so');
  const es = board.boardText('es', 'chat', 'monthly', chat, resetAt);
  assert.ok(es.includes('Ranking de chat [Mensual]') && es.includes('**Más activo en el chat**') && es.includes('8,372 mensajes') && es.includes('Se reinicia'), 'Spanish: the title, the words and the numbers as the bot writes them in Latin American Spanish');
  const pt = board.boardText('pt-BR', 'voice', 'daily', [{ username: 'a', amount: 7200 }], resetAt);
  assert.ok(board.boardText('pt-BR', 'chat', 'daily', [{ username: 'a', amount: 8372 }], resetAt).includes('8.372 mensagens'), 'Portuguese writes the thousands with a dot');
  assert.ok(pt.includes('Ranking de voz [Diário]') && pt.includes('120 minutos de voz') && pt.includes('Atualiza a cada 5 minutos!'), 'Portuguese');

  // ---- the SQL: the three tops in one trip, and the boards saved together
  nextRows = [
    { period: 'weekly', user_id: 'b', amount: '5' }, { period: 'weekly', user_id: 'a', amount: '5' }, { period: 'monthly', user_id: 'z', amount: '9' },
    { period: 'daily', user_id: 'a', amount: 1 }, { period: 'bogus', user_id: 'x', amount: 1 },
  ];
  const asks = [{ period: 'monthly', startDay: '2026-11-01' }, { period: 'weekly', startDay: '2026-10-26' }, { period: 'daily', startDay: '2026-11-11' }];
  const read = await realReadTops(GUILD, 'chat', asks, 30);
  assert.deepEqual(read.weekly.map((entry) => entry.user_id), ['a', 'b'], 'a tie goes by the id of the member, as the order of the database does');
  assert.deepEqual([read.monthly, read.daily], [[{ user_id: 'z', amount: 9 }], [{ user_id: 'a', amount: 1 }]], 'the amounts are numbers, each in its own period');
  assert.ok(!('bogus' in read), 'a period that was not asked for is dropped');
  let query = queries.at(-1);
  assert.ok(/with days as materialized/.test(query.sql) && (query.sql.match(/from activity_members/g) ?? []).length === 1, 'the days are read once, not once for each period');
  assert.equal((query.sql.match(/union all/g) ?? []).length, 2, 'and the three periods add them up in the same statement');
  assert.deepEqual([query.params[0], query.params[1], query.params[2]], [GUILD, '2026-10-26', 30], 'from the earliest day of the three');
  assert.ok(/messages/.test(query.sql) && !/voice_seconds/.test(query.sql), 'the chat counts messages');
  await realReadTops(GUILD, 'voice', [asks[0]], 500);
  query = queries.at(-1);
  assert.ok(/voice_seconds/.test(query.sql) && query.params[2] === 100, 'the voice counts seconds, and never more than 100 members are asked for');
  const before = queries.length;
  assert.deepEqual(await realReadTops(GUILD, 'chat', [], 30), { daily: [], weekly: [], monthly: [] });
  await realFlush([]);
  assert.equal(queries.length, before, 'nothing asked, nothing sent to the database');
  await realFlush([
    { guildId: '1', kind: 'chat', messageId: 'one', clearOld: true, state: { h: 'abc', at: 1 } },
    { guildId: '2', kind: 'voice', messageId: null, clearOld: false, state: null },
  ]);
  query = queries.at(-1);
  assert.ok(/unnest\(\$1::text\[\], \$2::text\[\], \$3::text\[\], \$4::text\[\], \$5::text\[\]\)/.test(query.sql) && queries.length === before + 1, 'any number of boards in one statement');
  assert.deepEqual(query.params.slice(0, 4), [['1', '2'], ['chat', 'voice'], ['one', ''], ['true', 'false']], 'the message goes with its board (nothing is the empty text), and which ones had their older messages deleted');
  assert.deepEqual(query.params[4], ['{"h":"abc","at":1}', ''], 'a board whose message was not written keeps the memory it had');
  assert.ok(/last_refreshed_at = now\(\), last_error = null/.test(query.sql) && /daily_message_id = case when v\.clear = 'true' then null else b\.daily_message_id end/.test(query.sql), 'every one counts as looked at, and the ids of the older way are forgotten only when they were deleted');

  // ---- a server with its channel, its members and what the messages do
  const me = { id: 'bot' };
  const members = new Collection();
  const addMember = (id, extra = {}) => members.set(id, { id, user: { id, username: `name_${id}`, bot: false }, ...extra });
  for (let index = 1; index <= 14; index += 1) addMember(`m${index}`);
  members.get('m3').user.bot = true;
  const calls = { sent: [], edited: [], deleted: [], fetched: [] };
  let sentCount = 0;
  const channel = (overrides = {}) => ({
    id: CHANNEL, type: ChannelType.GuildText,
    permissionsFor: () => ({ has: (flag) => overrides.denied?.includes(flag) !== true }),
    messages: {
      edit: async (id, payload) => { if (overrides.editError?.(id)) throw overrides.editError(id); calls.edited.push([id, payload]); },
      delete: async (id) => { calls.deleted.push(id); },
    },
    send: async (payload) => { if (overrides.sendError) throw overrides.sendError; sentCount += 1; const id = `msg${sentCount}`; calls.sent.push([id, payload]); return { id }; },
  });
  let currentChannel = channel();
  const makeGuild = (id) => ({
    id, name: 'Petto Land',
    members: { cache: members, me, fetch: async (query) => { calls.fetched.push(query.user); return new Collection(); } },
    channels: { fetch: async () => currentChannel },
  });
  const guild = makeGuild(GUILD);
  const client = { guilds: { cache: new Map([[GUILD, guild]]) } };
  /** A client with many servers, all like the one above. */
  const clientOf = (ids) => { for (const id of ids) i18n.setCachedGuildLanguage(id, 'en'); return { guilds: { cache: new Map(ids.map((id) => [id, makeGuild(id)])) } }; };

  // The database is replaced: what it would be asked, and what it answers.
  const saved = { errors: [] };
  const flushed = []; // every board saved, in order
  const flushCalls = []; // how many boards each statement carried
  const top = [{ user_id: 'm1', amount: 50 }, { user_id: 'gone', amount: 49 }, { user_id: 'm2', amount: 48 }, { user_id: 'm3', amount: 47 }, { user_id: 'm4', amount: 46 }, { user_id: 'm5', amount: 45 }, { user_id: 'm6', amount: 44 }, { user_id: 'm7', amount: 43 }, { user_id: 'm8', amount: 42 }, { user_id: 'm9', amount: 41 }, { user_id: 'm10', amount: 40 }, { user_id: 'm11', amount: 39 }, { user_id: 'm12', amount: 38 }];
  const asked = [];
  const same = (periods) => Object.fromEntries(periods.map(({ period }) => [period, top]));
  let topsOf = same;
  db.readTops = async (_guild, _kind, periods) => { asked.push(periods); return { daily: [], weekly: [], monthly: [], ...topsOf(periods) }; };
  db.flushRefreshed = async (entries) => { flushCalls.push(entries.length); flushed.push(...entries); };
  db.markError = async (_guild, _kind, code) => { saved.errors.push(code); };
  const row = (extra = {}) => ({ guild_id: GUILD, kind: 'chat', channel_id: CHANNEL, message_id: null, daily_message_id: null, weekly_message_id: null, monthly_message_id: null, card_state: null, last_refreshed_at: null, last_error: null, ...extra });
  const reset = () => { calls.sent.length = 0; calls.edited.length = 0; calls.deleted.length = 0; calls.fetched.length = 0; flushed.length = 0; flushCalls.length = 0; saved.errors.length = 0; asked.length = 0; };
  const lastEntry = () => flushed.at(-1);
  const when = new Date('2026-11-12T03:00:00Z');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set(['m4']) });

  // The first time: ONE message with the three cards, one under the other, and what it said is remembered.
  let result = await board.refreshBoard(client, row(), { now: when });
  assert.deepEqual(result, { ok: true, wrote: true, edits: 1 });
  assert.equal(calls.sent.length, 1, 'one message, not three');
  assert.equal(calls.sent[0][1].components.length, 3, 'with a card for each period');
  const first = JSON.stringify(calls.sent[0][1].components.map((card) => card.toJSON()));
  assert.deepEqual([...first.matchAll(/Leaderboard \[(\w+)\]/g)].map((match) => match[1]), ['Monthly', 'Weekly', 'Daily'], 'the month first, the day last');
  assert.deepEqual([lastEntry().messageId, lastEntry().clearOld], ['msg1', false]);
  assert.equal(flushed.length, 1, 'saved once');
  assert.equal(asked.length, 1, 'the three tops are read in one trip');
  assert.deepEqual(asked[0].map((each) => each.startDay), ['2026-11-01', '2026-11-09', '2026-11-11'], 'each card reads from the start of its period');
  assert.ok(calls.sent[0][1].flags === MessageFlags.IsComponentsV2 && calls.sent[0][1].allowedMentions.parse.length === 0, 'a Components V2 message that mentions nobody');
  assert.ok(first.includes('`name_m1`') && first.includes('`name_m2`'), 'members are shown by their username');
  assert.ok(!first.includes('name_m3') && !first.includes('name_m4') && !first.includes('gone'), 'a bot, who asked not to be counted and who left the server are not in the top');
  assert.equal((first.match(/`name_m\d+`/g) ?? []).length, 30, 'and each card is still full: the next ones take their place, up to ten in each');
  assert.ok(first.includes('`name_m12`'), 'the tenth is the twelfth of the list, after leaving out a bot, one who asked not to be counted and one who left');
  assert.deepEqual(calls.fetched.flat(), ['gone', 'gone', 'gone'], 'the ones that are not in the cache are asked for (once for each card)');
  const memory = lastEntry().state;
  assert.deepEqual(Object.keys(memory).sort(), ['at', 'h'], 'what the message said is remembered');
  assert.ok(/^[0-9a-f]{16}$/.test(memory.h) && memory.at === when.getTime(), 'as a short hash and the moment');

  // The next times: a message that says the same is not edited again (a quiet server costs Discord nothing), one that changed is edited, and so is every one after hours.
  const single = { message_id: 'one' };
  const remembered = (extra = {}) => row({ ...single, card_state: memory, ...extra });
  reset();
  result = await board.refreshBoard(client, remembered(), { now: when });
  assert.deepEqual([result, calls.sent.length, calls.edited.length], [{ ok: true, wrote: false, edits: 0 }, 0, 0], 'nothing new: nothing is written at Discord');
  assert.deepEqual([flushed.length, lastEntry().state, lastEntry().messageId], [1, null, 'one'], 'but it counts as looked at, and there is nothing new to remember');
  reset();
  result = await board.refreshBoard(client, remembered(), { now: when, force: true });
  assert.deepEqual([calls.sent.length, calls.edited.map(([id]) => id), result.edits], [0, ['one'], 1], 'a command writes it anyway: one edit');
  reset();
  topsOf = (periods) => Object.fromEntries(periods.map(({ period }) => [period, period === 'daily' ? [{ user_id: 'm1', amount: 99 }] : top]));
  result = await board.refreshBoard(client, remembered(), { now: when });
  assert.deepEqual([result.wrote, calls.edited.map(([id]) => id)], [true, ['one']], 'when any card changed the message is edited, once');
  assert.ok(lastEntry().state.h !== memory.h, 'and it remembers the new text');
  topsOf = same;
  // (from the middle of the day, so that the day itself does not change in the hours that pass)
  const noon = new Date('2026-11-12T15:00:00Z');
  reset();
  await board.refreshBoard(client, row(single), { now: noon, force: true });
  const noonMemory = lastEntry().state;
  reset();
  result = await board.refreshBoard(client, remembered({ card_state: noonMemory }), { now: new Date(noon.getTime() + 5 * HOUR) });
  assert.equal(calls.edited.length, 0, 'after five hours with the same text it is still left alone');
  reset();
  result = await board.refreshBoard(client, remembered({ card_state: noonMemory }), { now: new Date(noon.getTime() + 6 * HOUR + 60_000) });
  assert.deepEqual(calls.edited.map(([id]) => id), ['one'], 'after six hours it is edited anyway, which is how a deleted one is found when nobody has said anything');

  // A board older than the memory (or with the memory of the older way, one for each card) is not written, it only starts remembering, at a time spread over the hours (a restart
  // or an update never edits every board at once).
  reset();
  result = await board.refreshBoard(client, row(single), { now: when });
  assert.deepEqual([result, calls.sent.length, calls.edited.length], [{ ok: true, wrote: false, edits: 0 }, 0, 0], 'nothing is written');
  assert.ok(lastEntry().state.h === memory.h && lastEntry().state.at <= when.getTime() && lastEntry().state.at > when.getTime() - 6 * HOUR, 'but it is remembered, with the hash of today and a time somewhere in the last six hours');
  reset();
  result = await board.refreshBoard(client, row({ ...single, card_state: { daily: { h: 'x', at: 1 }, weekly: { h: 'y', at: 1 } } }), { now: when });
  assert.deepEqual([calls.edited.length, typeof lastEntry().state.h], [0, 'string'], 'the memory of the older way is not used: it is replaced');
  reset();
  result = await board.refreshBoard(client, row(single), { now: when, force: true });
  assert.deepEqual(calls.edited.map(([id]) => id), ['one'], 'a command still writes it');

  // Someone deleted it: it is posted again.
  reset();
  const gone = Object.assign(new Error('Unknown Message'), { code: 10008 });
  currentChannel = channel({ editError: () => gone });
  result = await board.refreshBoard(client, remembered(), { now: when, force: true });
  assert.equal(result.ok, true);
  assert.deepEqual([calls.deleted.length, calls.sent.length, lastEntry().messageId], [0, 1, 'msg2'], 'a new message is posted (the old one is gone: nothing to delete)');
  assert.deepEqual(Object.keys(lastEntry().state).sort(), ['at', 'h'], 'and remembered');
  currentChannel = channel();

  // The boards written the older way (a message for each period) become one: the new message is posted first, the old ones are deleted after, and their ids are forgotten.
  reset();
  const older = { daily_message_id: 'd', weekly_message_id: 'w', monthly_message_id: 'm' };
  result = await board.refreshBoard(client, row(older), { now: when });
  assert.deepEqual([calls.sent.length, [...calls.deleted], result.edits], [1, ['m', 'w', 'd'], 4], 'one message posted, three deleted');
  assert.deepEqual([lastEntry().messageId, lastEntry().clearOld, typeof lastEntry().state.h], ['msg3', true, 'string'], 'saved with the new message and the old ids forgotten');
  reset();
  result = await board.refreshBoard(client, row({ ...single, ...older, card_state: memory }), { now: when });
  assert.deepEqual([calls.sent.length, calls.edited.length, [...calls.deleted], lastEntry().clearOld], [0, 0, ['m', 'w', 'd'], true], 'a board that has both (a migration that stopped half way) only deletes the old ones');
  // The order matters when the new message cannot be posted: the old ones stay, so there is never a moment with nothing.
  reset();
  currentChannel = channel({ sendError: new Error('boom') });
  result = await board.refreshBoard(client, row(older), { now: when });
  assert.deepEqual([result.ok, calls.deleted.length, flushed.length], [false, 0, 0], 'if the new message fails, the old ones are not touched');
  currentChannel = channel();

  // The periods a server chose: only those cards are in the message.
  reset();
  result = await board.refreshBoard(client, row({ periods: ['weekly'] }), { now: when });
  assert.deepEqual([calls.sent.length, calls.sent[0][1].components.length], [1, 1], 'one message with one card');
  assert.deepEqual([...JSON.stringify(calls.sent[0][1].components.map((card) => card.toJSON())).matchAll(/Leaderboard \[(\w+)\]/g)].map((match) => match[1]), ['Weekly'], 'the week');
  assert.deepEqual(asked[0].map((each) => each.period), ['weekly'], 'and only the week is read');
  reset();
  result = await board.refreshBoard(client, remembered({ periods: ['weekly', 'daily'] }), { now: when });
  assert.deepEqual([calls.sent.length, calls.deleted.length, calls.edited.map(([id]) => id)], [0, 0, ['one']], 'a period that was taken away or added only changes the message: it is edited, nothing is posted or deleted');
  assert.equal(calls.edited[0][1].components.length, 2, 'now with two cards');
  reset();
  result = await board.refreshBoard(client, row({ periods: ['monthly', 'daily'] }), { now: when });
  assert.deepEqual([...JSON.stringify(calls.sent[0][1].components.map((card) => card.toJSON())).matchAll(/Leaderboard \[(\w+)\]/g)].map((match) => match[1]), ['Monthly', 'Daily'], 'the month and the day, without the week');
  assert.deepEqual(db.cleanPeriods(['daily', 'nothing', 'monthly', 'daily']), ['monthly', 'daily'], 'the periods are kept in order, once each, and only real ones');
  assert.deepEqual([db.cleanPeriods([]), db.cleanPeriods(undefined), db.cleanPeriods('weekly'), db.cleanPeriods(['x'])], [['monthly', 'weekly', 'daily'], ['monthly', 'weekly', 'daily'], ['monthly', 'weekly', 'daily'], ['monthly', 'weekly', 'daily']], 'a list with none of them is all of them');

  // The text of a message of components cannot pass 4000 characters in all: when the three cards do not fit, every one shows one place less.
  const longNames = Array.from({ length: 12 }, (_, index) => ({ user_id: `l${index}`, amount: 1_234_567 - index }));
  for (const member of longNames) members.set(member.user_id, { id: member.user_id, user: { id: member.user_id, username: `${'x'.repeat(30)}${String(member.user_id).slice(1).padStart(2, '0')}`, bot: false } });
  topsOf = (periods) => Object.fromEntries(periods.map(({ period }) => [period, longNames]));
  reset();
  result = await board.refreshBoard(client, row(), { now: when });
  const widest = calls.sent[0][1].components.map((card) => JSON.stringify(card.toJSON()));
  const characters = calls.sent[0][1].components.map((card) => card.toJSON().components.map((part) => part.content ?? '').join('')).join('').length;
  assert.ok(characters <= board.TEXT_LIMIT, `three full cards of long names fit in the message (${characters} characters)`);
  const places = Math.max(...widest.map((card) => (card.match(/`x{30}\d{2}`/g) ?? []).length));
  assert.ok(places < 10 && places >= board.MIN_PLACES, `with the longest names every card shows ${places} places instead of ten, and never fewer than ${board.MIN_PLACES}`);
  topsOf = same;
  reset();
  await board.refreshBoard(client, row(), { now: when });
  assert.equal((JSON.stringify(calls.sent[0][1].components.map((card) => card.toJSON())).match(/`name_m\d+`/g) ?? []).length, 30, 'with ordinary names all ten places stay');
  assert.ok(board.TEXT_LIMIT <= 4000 && board.TEXT_LIMIT >= 3500, 'the limit is under the 4000 of Discord, with a margin');

  // The reasons a board cannot be written are saved, and nothing throws.
  currentChannel = channel();
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: false, members: true, content: true }]]), optedOut: new Set() });
  reset();
  assert.deepEqual(await board.refreshBoard(client, row(), { now: when }), { ok: false, reason: 'statsOff' });
  assert.deepEqual([saved.errors, calls.sent.length], [['statsOff'], 0], 'a server with statistics off gets no board');
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: true, members: false, content: true }]]), optedOut: new Set() });
  reset();
  assert.equal((await board.refreshBoard(client, row(), { now: when })).reason, 'membersOff', 'statistics without members cannot name anybody');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set() });
  currentChannel = null;
  reset();
  assert.equal((await board.refreshBoard(client, row(), { now: when })).reason, 'channel', 'a channel that is gone');
  currentChannel = channel({ denied: [PermissionFlagsBits.SendMessages] });
  reset();
  assert.equal((await board.refreshBoard(client, row(), { now: when })).reason, 'permissions', 'without Send Messages');
  currentChannel = channel({ sendError: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
  reset();
  assert.equal((await board.refreshBoard(client, row(), { now: when })).reason, 'permissions', 'Discord refuses while writing');
  currentChannel = channel({ sendError: Object.assign(new Error('Unknown Channel'), { code: 10003 }) });
  reset();
  assert.equal((await board.refreshBoard(client, row(), { now: when })).reason, 'channel', 'the channel is deleted while writing');
  currentChannel = channel({ sendError: new Error('boom') });
  reset();
  assert.deepEqual(await board.refreshBoard(client, row(), { now: when }), { ok: false, reason: 'error' }, 'any other failure is kept as a plain one');
  assert.equal(flushed.length, 0, 'and is not counted as written');
  currentChannel = channel();
  reset();
  assert.deepEqual(await board.refreshBoard({ guilds: { cache: new Map() } }, row(single), { now: when }), { ok: false, reason: 'error' });
  assert.deepEqual(saved.errors, [], 'a server that is not reachable now is not blamed');
  assert.deepEqual([flushed.length, lastEntry().state, lastEntry().messageId, lastEntry().clearOld], [1, null, 'one', false], 'but it counts as looked at, so it goes to the back of the line and never holds back the boards behind it');

  // ---- what boards may write to Discord: a bucket that fills with time
  statsRules.setForTests({ configs: new Map(), optedOut: new Set(['m4']) }); // as at the beginning: m4 asked not to be counted, so the cards say what they said
  let clockMs = 0;
  const bucket = board.createEditBudget({ perSecond: 2, capacity: 12, now: () => clockMs });
  assert.deepEqual([bucket.available(), bucket.take(10), bucket.take(5), bucket.available()], [12, true, false, 2], 'it starts full, and a request for more than it has is refused whole');
  clockMs += 1000;
  assert.deepEqual([bucket.take(4), bucket.available()], [true, 0], 'it gets back what the second gave');
  clockMs += 60_000;
  assert.equal(bucket.available(), 12, 'but never holds more than its capacity');
  assert.equal(config.activityBoardEditsPerSecond, Math.max(1, Math.floor(config.restRequestsPerSecond / 2)), 'boards take half of what the bot may send to Discord, so the rest of the work keeps its part');

  // A board that needs more writes than the bucket has is not touched, and stays due.
  reset();
  const poor = board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 });
  poor.take(12);
  const pending = [];
  result = await board.refreshBoard(client, row(), { now: when, budget: poor, pending });
  assert.deepEqual(result, { ok: false, deferred: true }, 'a post, no writes left: it waits');
  assert.deepEqual([calls.sent.length, pending.length, flushed.length, poor.available()], [0, 0, 0, 0], 'nothing was written, nothing saved (so it is still the first in line) and the budget is not spent');
  result = await board.refreshBoard(client, remembered(), { now: when, budget: poor, pending });
  assert.deepEqual([result.wrote, pending.length, flushed.length], [false, 1, 0], 'a message with nothing new costs no writes, so it needs no budget; what it found waits in the list of the round');
  result = await board.refreshBoard(client, remembered(), { now: when, force: true, budget: poor, pending: [] });
  assert.deepEqual([result.deferred, calls.edited.length], [true, 0], 'an edit, no writes left: it waits');
  // A board of the older way costs one post and three deletes: four writes.
  const four = board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 });
  four.take(9);
  result = await board.refreshBoard(client, row(older), { now: when, budget: four, pending: [] });
  assert.deepEqual([result.deferred, calls.sent.length, four.available()], [true, 0, 3], 'three writes left: the migration waits, and touches nothing');
  four.take(0);
  const five = board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 });
  five.take(8);
  result = await board.refreshBoard(client, row(older), { now: when, budget: five, pending: [] });
  assert.deepEqual([result.edits, five.available()], [4, 0], 'four writes: it goes and spends them');
  const one = board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 });
  one.take(11);
  result = await board.refreshBoard(client, remembered(), { now: when, force: true, budget: one, pending: [] });
  assert.deepEqual([result.edits, one.available()], [1, 0], 'a board of one message needs one write where three needed three');

  // ---- the job: the boards that are due, in batches, and one that fails does not stop the others
  reset();
  const BIG = () => board.createEditBudget({ perSecond: 100, capacity: 1000, now: () => 0 });
  db.listDue = async () => [row({ kind: 'chat' }), row({ guild_id: '999999999999999999', kind: 'voice' }), row({ kind: 'voice' })];
  let ran = await board.runDueBoards(client, { budget: BIG() });
  assert.equal(ran, 3);
  assert.deepEqual(flushCalls, [3], 'the three are saved in one statement');
  assert.equal(calls.sent.length, 2, 'the two that can be reached were written (a message each), the third (another server) only counted as looked at');
  assert.deepEqual(flushed.map((entry) => `${entry.guildId.slice(0, 3)}:${entry.kind}`).sort(), ['111:chat', '111:voice', '999:voice']);

  // Thousands of boards: it asks again while there are more due, a batch at a time, and a board is looked at once.
  const ids = Array.from({ length: 7 }, (_, index) => `3000000000000000${String(index).padStart(2, '0')}`);
  const many = clientOf(ids);
  reset();
  await board.refreshBoard(client, row(single), { now: new Date(), force: true }); // what the cards say today (the job asks for the clock of now)
  const liveMemory = lastEntry().state;
  const everyone = ids.map((id) => row({ ...single, guild_id: id, card_state: liveMemory }));
  const done = new Set();
  db.listDue = async (limit) => everyone.filter((each) => !done.has(each.guild_id)).slice(0, limit);
  db.flushRefreshed = async (entries) => { flushCalls.push(entries.length); for (const entry of entries) done.add(entry.guildId); };
  reset();
  ran = await board.runDueBoards(many, { limit: 3, budget: BIG() });
  assert.deepEqual([ran, flushCalls], [7, [3, 3, 1]], 'seven boards in batches of three, all looked at, each batch saved in one statement');
  assert.equal(calls.edited.length + calls.sent.length, 0, 'and boards with nothing new wrote nothing');
  done.clear();
  let clockTick = 0;
  reset();
  ran = await board.runDueBoards(many, { limit: 3, budgetMs: 5, now: () => { clockTick += 2; return clockTick; }, budget: BIG() });
  assert.ok(ran < 7, 'a round stops when its time is spent, and the boards that are left are the first at the next look');

  // When there are more writes to make than the budget allows, the round ends and the boards left wait, still due, oldest first. (Here, boards of the older way: four writes each.
  // This is what happens when the bot starts after this change: every board is made into one message, a few at a time, and a board is never left without its message.)
  const toMigrate = ids.map((id) => row({ guild_id: id, ...older }));
  const finished = new Set();
  db.listDue = async (limit) => toMigrate.filter((each) => !finished.has(each.guild_id)).slice(0, limit);
  db.flushRefreshed = async (entries) => { flushCalls.push(entries.length); for (const entry of entries) finished.add(entry.guildId); };
  reset();
  const twelve = board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 });
  ran = await board.runDueBoards(many, { budget: twelve });
  assert.deepEqual([ran, calls.sent.length, calls.deleted.length, finished.size, twelve.available()], [3, 3, 9, 3, 0], 'twelve writes are three boards of four; the four that are left were not touched');
  ran = await board.runDueBoards(many, { budget: board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 }) });
  assert.deepEqual([ran, finished.size], [3, 6], 'at the next look three more');
  ran = await board.runDueBoards(many, { budget: board.createEditBudget({ perSecond: 1, capacity: 12, now: () => 0 }) });
  assert.deepEqual([ran, finished.size], [1, 7], 'and the last one: all of them are one message now');

  // A board that cannot be looked at is counted as looked at, so it does not come back at once and the others are not held back.
  reset();
  const failing = [row({ kind: 'chat' }), row({ kind: 'voice' })];
  db.listDue = async () => failing;
  db.flushRefreshed = async (entries) => { flushCalls.push(entries.length); flushed.push(...entries); };
  db.readTops = async () => { throw new Error('the database is down'); };
  const keepWarn = logger.warn;
  const warned = [];
  logger.warn = (message) => { warned.push(String(message)); };
  ran = await board.runDueBoards(client, { budget: BIG() });
  assert.deepEqual([ran, saved.errors], [2, ['error', 'error']], 'both were looked at and kept as a plain failure, once each');
  db.readTops = async (_guild, _kind, periods) => { asked.push(periods); return { daily: [], weekly: [], monthly: [], ...topsOf(periods) }; };

  // The team is told when the promise of every 5 minutes is not being kept (a board that waited more than twice that), and not more than every 10 minutes.
  const late = row({ ...single, card_state: memory, last_refreshed_at: new Date(Date.now() - 12 * 60_000).toISOString() });
  db.listDue = async () => [late];
  warned.length = 0;
  await board.runDueBoards(client, { budget: BIG() });
  assert.ok(warned.some((message) => /running late/.test(message) && /12 minutes/.test(message) && /PETTO_ACTIVITY_BOARD_EDITS_PER_SECOND/.test(message)), 'a warning with how long it waited and what to change');
  const count = warned.length;
  await board.runDueBoards(client, { budget: BIG() });
  assert.equal(warned.length, count, 'but not again at the next look');
  warned.length = 0;
  db.listDue = async () => [row({ ...single, card_state: memory, last_refreshed_at: new Date(Date.now() - 4 * 60_000).toISOString() })];
  await board.runDueBoards(client, { budget: BIG() });
  assert.equal(warned.length, 0, 'a board that waited the normal time says nothing');
  logger.warn = keepWarn;
  assert.ok(db.REFRESH_SECONDS >= 240 && db.REFRESH_SECONDS < 300, 'a board is due a little before 5 minutes after its last time');
  assert.ok(db.REFRESH_SECONDS + 15 <= 300, 'and with a look every 15 seconds the longest wait is still under 5 minutes');
  assert.ok(/POLL_INTERVAL_MS = 15_000/.test(fs.readFileSync(path.join(__dirname, '..', 'src/jobs/activityLeaderboardJob.ts'), 'utf8')), 'the job looks every 15 seconds');
  assert.ok(/'activityLeaderboardJob'/.test(fs.readFileSync(path.join(__dirname, '..', 'src/utils/loadGuard.js'), 'utf8')), 'the load guard pauses it when the bot is degraded');
  db.listDue = async () => [];
  db.flushRefreshed = async (entries) => { flushCalls.push(entries.length); flushed.push(...entries); };

  // ---- the command
  let stored = null;
  let removedRow = null;
  const listed = [];
  db.upsertBoard = async (guildId, kind, channelId, periods) => { stored = { guildId, kind, channelId, periods }; return row({ kind, channel_id: channelId, periods: periods ?? ['monthly', 'weekly', 'daily'] }); };
  db.removeBoard = async () => removedRow;
  db.listBoards = async () => listed;
  const interaction = (sub, opts = {}, { allowed = true } = {}) => {
    const log = { replies: [], edits: [], deferred: 0 };
    return {
      log,
      value: {
        guild, guildId: GUILD, client, locale: 'en-US', guildLocale: 'en-US', user: { id: 'u' },
        memberPermissions: { has: (flag) => allowed && flag === PermissionFlagsBits.ManageGuild },
        options: { getSubcommand: () => sub, getString: (name) => opts[name] ?? null, getChannel: () => ({ id: CHANNEL }) },
        deferred: false, replied: false,
        deferReply: async function defer() { log.deferred += 1; this.deferred = true; },
        reply: async function reply(payload) { log.replies.push(payload); this.replied = true; },
        editReply: async (payload) => { log.edits.push(payload); },
      },
    };
  };
  const run = async (sub, opts, flags) => { const made = interaction(sub, opts, flags); await command.execute(made.value); return made.log; };
  const said = (payload) => text(payload);

  let log = await run('set', { type: 'chat' }, { allowed: false });
  assert.ok(said(log.replies[0]).includes('Manage Server') && stored === null, 'only who has Manage Server');
  assert.equal(log.replies[0].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral, 'the refusal is private');
  reset();
  log = await run('set', { type: 'chat' });
  assert.deepEqual(stored, { guildId: GUILD, kind: 'chat', channelId: CHANNEL, periods: undefined }, 'the channel is saved, and the periods it had are kept');
  assert.equal(calls.sent.length, 1, 'and the board is written at once, as one message');
  assert.ok(said(log.edits.at(-1)).includes('<#222222222222222222>') && said(log.edits.at(-1)).includes('every 5 minutes') && said(log.edits.at(-1)).includes('Month, Week, Day'), 'the answer says where they are, which cards and how often');
  reset();
  log = await run('set', { type: 'chat', periods: 'weekly-daily' });
  assert.deepEqual(stored.periods, ['weekly', 'daily'], 'the week and the day only');
  assert.ok(said(log.edits.at(-1)).includes('Week, Day') && !said(log.edits.at(-1)).includes('Month'), 'and the answer says so');
  log = await run('set', { type: 'chat', periods: 'monthly' });
  assert.deepEqual(stored.periods, ['monthly'], 'only the month');
  log = await run('set', { type: 'chat', periods: 'all' });
  assert.deepEqual(stored.periods, ['monthly', 'weekly', 'daily'], 'all of them');
  const setOptions = command.data.toJSON().options.find((option) => option.name === 'set').options;
  const periodOption = setOptions.find((option) => option.name === 'periods');
  assert.ok(periodOption && !periodOption.required, 'an optional option of set');
  assert.deepEqual(periodOption.choices.map((choice) => choice.value), ['all', 'monthly', 'weekly', 'daily', 'monthly-weekly', 'monthly-daily', 'weekly-daily'], 'every way to choose the cards');
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: false, members: true, content: true }]]), optedOut: new Set() });
  stored = null;
  log = await run('set', { type: 'voice' });
  assert.ok(said(log.replies[0]).includes('statistics off') && stored === null, 'a server with statistics off is told and nothing is saved');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set() });
  currentChannel = channel({ denied: [PermissionFlagsBits.ReadMessageHistory] });
  log = await run('set', { type: 'voice' });
  assert.ok(said(log.replies[0]).includes('Read Message History') && stored === null, 'a channel Petto cannot use is refused before saving');
  currentChannel = channel();

  removedRow = null;
  log = await run('remove', { type: 'chat' });
  assert.ok(said(log.replies[0]).includes('no **chat** leaderboards'), 'nothing to remove');
  removedRow = row({ message_id: 'one', daily_message_id: 'd', weekly_message_id: 'w', monthly_message_id: 'm' });
  reset();
  log = await run('remove', { type: 'chat' });
  assert.deepEqual([...calls.deleted].sort(), ['d', 'm', 'one', 'w'], 'its message is deleted, and the ones of the older way too');
  assert.ok(said(log.edits.at(-1)).includes('taken away'));

  log = await run('status');
  assert.ok(said(log.replies[0]).includes('/activityboard set'), 'no boards yet');
  listed.push(row({ last_refreshed_at: '2026-11-12T02:00:00Z' }), row({ kind: 'voice', last_error: 'permissions' }));
  log = await run('status');
  const status = said(log.replies[0]);
  assert.ok(status.includes('**chat** in <#222222222222222222>') && status.includes('updated <t:') && status.includes('**voice**') && status.includes('View Channel'), 'where each is, when it was updated and what is wrong');
  assert.ok(status.includes('Cards: Month, Week, Day'), 'and which cards it has');

  reset();
  log = await run('refresh');
  assert.equal(calls.sent.length >= 2, true, 'both boards are written again, a message each');
  log = await run('refresh');
  assert.ok(said(log.replies[0]).includes('Wait a minute'), 'one refresh a minute for each server');

  // ---- the pieces are in place
  const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(/create table if not exists activity_leaderboards/.test(source('src/db/schema.sql')), 'the table');
  assert.ok(/alter table activity_leaderboards add column if not exists periods text\[\] not null default '\{monthly,weekly,daily\}'/.test(source('src/db/schema.sql')), 'the periods, and the boards that existed keep all three');
  assert.ok(/alter table activity_leaderboards add column if not exists card_state jsonb not null default '\{\}'::jsonb/.test(source('src/db/schema.sql')) && /alter table activity_leaderboards add column if not exists message_id text/.test(source('src/db/schema.sql')), 'the one message and the memory of it, empty for the boards that exist');
  assert.ok(/create index if not exists idx_activity_leaderboards_due on activity_leaderboards \(last_refreshed_at asc nulls first\)/.test(source('src/db/schema.sql')), 'the boards that are due are found by the time of their last look');
  assert.ok(/PETTO_ACTIVITY_BOARD_EDITS_PER_SECOND/.test(source('docs/REFERENCE.md')), 'the setting is documented');
  assert.ok(/startActivityLeaderboardJob\(client\)/.test(source('index.js')), 'the job starts');
  assert.ok(!/content/.test(source('src/db/activityLeaderboards.ts').replace(/content-type/g, '').replace(/what was said/g, '')), 'nothing about what was said is read');
  console.log('Activity leaderboard checks passed (periods, the card, writing and editing, the memory of the cards, the reasons it fails, who is in the top, the budget of writes, the job in batches, the SQL, the command).');
})().catch((err) => { console.error(err); process.exit(1); });

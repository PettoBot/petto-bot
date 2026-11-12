// Checks the activity leaderboards: the day, week and month of Petto (GMT-5) and when each ends, the words of a card in the three languages, writing the three messages
// (the first time, the edits, a deleted one, the reasons a board cannot be written), who may be in a top, the job that goes through the boards that are due, and the command.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const i18n = require('../src/i18n');
const db = require('../src/db/activityLeaderboards');
const statsRules = require('../src/db/statsRules');
const board = require('../src/utils/activityLeaderboard');
const command = require('../src/commands/info/activityboard.js');

const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
i18n.setCachedGuildLanguage(GUILD, 'en');
const text = (payload) => JSON.stringify(payload.components[0].toJSON());

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
  const guild = {
    id: GUILD, name: 'Petto Land',
    members: { cache: members, me, fetch: async (query) => { calls.fetched.push(query.user); return new Collection(); } },
    channels: { fetch: async () => currentChannel },
  };
  const client = { guilds: { cache: new Map([[GUILD, guild]]) } };

  // The database is replaced: what it would be asked, and what it answers.
  const saved = { messages: null, refreshed: 0, errors: [] };
  const top = [{ user_id: 'm1', amount: 50 }, { user_id: 'gone', amount: 49 }, { user_id: 'm2', amount: 48 }, { user_id: 'm3', amount: 47 }, { user_id: 'm4', amount: 46 }, { user_id: 'm5', amount: 45 }, { user_id: 'm6', amount: 44 }, { user_id: 'm7', amount: 43 }, { user_id: 'm8', amount: 42 }, { user_id: 'm9', amount: 41 }, { user_id: 'm10', amount: 40 }, { user_id: 'm11', amount: 39 }, { user_id: 'm12', amount: 38 }];
  const asked = [];
  db.readTop = async (...args) => { asked.push(args); return top; };
  db.saveMessages = async (_guild, _kind, ids) => { saved.messages = ids; };
  db.markRefreshed = async () => { saved.refreshed += 1; };
  db.markError = async (_guild, _kind, code) => { saved.errors.push(code); };
  const row = (extra = {}) => ({ guild_id: GUILD, kind: 'chat', channel_id: CHANNEL, daily_message_id: null, weekly_message_id: null, monthly_message_id: null, last_refreshed_at: null, last_error: null, ...extra });
  const reset = () => { calls.sent.length = 0; calls.edited.length = 0; calls.deleted.length = 0; calls.fetched.length = 0; saved.messages = null; saved.refreshed = 0; saved.errors.length = 0; asked.length = 0; };
  const when = new Date('2026-11-12T03:00:00Z');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set(['m4']) });

  // The first time: the three messages are posted in order and remembered.
  let result = await board.refreshBoard(client, row(), { now: when });
  assert.deepEqual(result, { ok: true, wrote: true });
  assert.equal(calls.sent.length, 3, 'three messages');
  assert.deepEqual(calls.sent.map(([, payload]) => (text(payload).match(/Leaderboard \[(\w+)\]/) ?? [])[1]), ['Monthly', 'Weekly', 'Daily'], 'the month first, the day last');
  assert.deepEqual(saved.messages, { daily: 'msg3', weekly: 'msg2', monthly: 'msg1' });
  assert.equal(saved.refreshed, 1);
  assert.deepEqual(asked.map((args) => args[2]), ['2026-11-01', '2026-11-09', '2026-11-11'], 'each card reads from the start of its period');
  assert.ok(calls.sent.every(([, payload]) => payload.flags === MessageFlags.IsComponentsV2 && payload.allowedMentions.parse.length === 0), 'a Components V2 message that mentions nobody');
  const cardText = text(calls.sent[0][1]);
  assert.ok(cardText.includes('`name_m1`') && cardText.includes('`name_m2`'), 'members are shown by their username');
  assert.ok(!cardText.includes('name_m3') && !cardText.includes('name_m4') && !cardText.includes('gone'), 'a bot, who asked not to be counted and who left the server are not in the top');
  assert.equal((cardText.match(/`name_m\d+`/g) ?? []).length, 10, 'and the card is still full: the next ones take their place, up to ten');
  assert.ok(cardText.includes('`name_m12`'), 'the tenth is the twelfth of the list, after leaving out a bot, one who asked not to be counted and one who left');
  assert.deepEqual(calls.fetched.flat(), ['gone', 'gone', 'gone'], 'the ones that are not in the cache are asked for (once for each card)');

  // The next times: a card that says the same is not edited again (a quiet server costs Discord nothing), one that changed is edited, and so is every one after an hour.
  const messages = { daily_message_id: 'd', weekly_message_id: 'w', monthly_message_id: 'm' };
  reset();
  result = await board.refreshBoard(client, row(messages), { now: when });
  assert.deepEqual([result, calls.sent.length, calls.edited.length], [{ ok: true, wrote: false }, 0, 0], 'nothing new: nothing is written at Discord');
  assert.equal(saved.refreshed, 1, 'but it counts as looked at');
  reset();
  result = await board.refreshBoard(client, row(messages), { now: when, force: true });
  assert.deepEqual([calls.sent.length, calls.edited.map(([id]) => id)], [0, ['m', 'w', 'd']], 'a command writes them anyway: three edits, in order');
  reset();
  const keepRead = db.readTop;
  db.readTop = async (guildId, kind, sinceDay) => (sinceDay === '2026-11-11' ? [{ user_id: 'm1', amount: 99 }] : top);
  result = await board.refreshBoard(client, row(messages), { now: when });
  assert.deepEqual([result.wrote, calls.edited.map(([id]) => id)], [true, ['d']], 'only the card that changed is edited');
  db.readTop = keepRead;
  reset();
  await board.refreshBoard(client, row(messages), { now: when, force: true }); // the three are as they were
  reset();
  result = await board.refreshBoard(client, row(messages), { now: new Date(when.getTime() + 56 * 60_000) });
  assert.deepEqual(calls.edited.map(([id]) => id), ['m', 'w', 'd'], 'after an hour they are edited anyway, which is how a deleted one is found');
  reset();
  await board.refreshBoard(client, row(messages), { now: when, force: true });

  // Someone deleted one: the rest go and all three are posted again, so they stay in order.
  reset();
  const gone = Object.assign(new Error('Unknown Message'), { code: 10008 });
  currentChannel = channel({ editError: (id) => (id === 'w' ? gone : null) });
  result = await board.refreshBoard(client, row(messages), { now: when, force: true });
  assert.equal(result.ok, true);
  assert.deepEqual([...calls.deleted].sort(), ['d', 'm', 'w'], 'the old ones are deleted');
  assert.equal(calls.sent.length, 3, 'and three new ones are posted');
  assert.deepEqual(saved.messages, { daily: 'msg6', weekly: 'msg5', monthly: 'msg4' });

  // The periods a server chose: only those cards are read and written.
  currentChannel = channel();
  reset();
  result = await board.refreshBoard(client, row({ periods: ['weekly'] }), { now: when });
  assert.deepEqual(calls.sent.map(([, payload]) => (text(payload).match(/Leaderboard \[(\w+)\]/) ?? [])[1]), ['Weekly'], 'only the week is posted');
  assert.deepEqual(asked.map((args) => args[2]), ['2026-11-09'], 'and only the week is read');
  assert.deepEqual(saved.messages, { daily: null, weekly: 'msg7', monthly: null }, 'the other two have no message');
  reset();
  result = await board.refreshBoard(client, row({ periods: ['weekly'], daily_message_id: 'd', weekly_message_id: 'w', monthly_message_id: 'm' }), { now: when, force: true });
  assert.deepEqual([...calls.deleted], ['m', 'd'], 'a period that was taken away loses its message');
  assert.deepEqual([calls.sent.length, calls.edited.map(([id]) => id)], [0, ['w']], 'the one that stays is edited where it is');
  assert.deepEqual(saved.messages, { daily: null, weekly: 'w', monthly: null });
  reset();
  result = await board.refreshBoard(client, row({ periods: ['weekly', 'daily'], weekly_message_id: 'w' }), { now: when });
  assert.deepEqual([...calls.deleted], ['w'], 'a period that was added: the card that was there is deleted');
  assert.deepEqual(calls.sent.map(([, payload]) => (text(payload).match(/Leaderboard \[(\w+)\]/) ?? [])[1]), ['Weekly', 'Daily'], 'and they are posted again in order');
  reset();
  result = await board.refreshBoard(client, row({ periods: ['monthly', 'daily'] }), { now: when });
  assert.deepEqual(calls.sent.map(([, payload]) => (text(payload).match(/Leaderboard \[(\w+)\]/) ?? [])[1]), ['Monthly', 'Daily'], 'the month and the day, without the week');
  assert.deepEqual(db.cleanPeriods(['daily', 'nothing', 'monthly', 'daily']), ['monthly', 'daily'], 'the periods are kept in order, once each, and only real ones');
  assert.deepEqual([db.cleanPeriods([]), db.cleanPeriods(undefined), db.cleanPeriods('weekly'), db.cleanPeriods(['x'])], [['monthly', 'weekly', 'daily'], ['monthly', 'weekly', 'daily'], ['monthly', 'weekly', 'daily'], ['monthly', 'weekly', 'daily']], 'a list with none of them is all of them');

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
  assert.equal(saved.refreshed, 0, 'and is not counted as written');
  currentChannel = channel();
  reset();
  assert.deepEqual(await board.refreshBoard({ guilds: { cache: new Map() } }, row(), { now: when }), { ok: false, reason: 'error' });
  assert.deepEqual(saved.errors, [], 'a server that is not reachable now is not blamed: it is looked at again');

  // ---- the job: the boards that are due, one after another, and one that fails does not stop the others
  reset();
  db.listDue = async () => [row({ kind: 'chat' }), row({ guild_id: '999999999999999999', kind: 'voice' }), row({ kind: 'voice' })];
  const pauses = [];
  const ran = await board.runDueBoards(client, { pauseMs: 1500, sleep: async (ms) => { pauses.push(ms); } });
  assert.equal(ran, 3);
  assert.deepEqual(pauses, [1500, 1500], 'a pause after each one that wrote at Discord (the one of another server did not)');
  assert.equal(calls.sent.length, 6, 'the two that can be reached were written, the third (another server) was skipped');
  // A board with nothing new needs no pause, and a round stops when its time is spent.
  reset();
  await board.refreshBoard(client, row(messages), { now: new Date(), force: true });
  db.listDue = async () => [row(messages), row({ ...messages, kind: 'voice' })];
  pauses.length = 0;
  reset();
  await board.runDueBoards(client, { pauseMs: 1500, sleep: async (ms) => { pauses.push(ms); } });
  assert.ok(pauses.length <= 1, 'the one with nothing new does not pause');
  let clock = 0;
  const limited = await board.runDueBoards(client, { budgetMs: 15, now: () => { clock += 10; return clock; }, sleep: async () => {} });
  assert.ok(limited < 2, 'a round stops when its time is spent');
  assert.ok(db.REFRESH_SECONDS >= 240 && db.REFRESH_SECONDS < 300, 'a board is due a little before 5 minutes after its last time');
  assert.ok(/POLL_INTERVAL_MS = 60_000/.test(fs.readFileSync(path.join(__dirname, '..', 'src/jobs/activityLeaderboardJob.ts'), 'utf8')), 'the job looks every minute, so a board is written about every 5 minutes');
  assert.ok(/'activityLeaderboardJob'/.test(fs.readFileSync(path.join(__dirname, '..', 'src/utils/loadGuard.js'), 'utf8')), 'the load guard pauses it when the bot is degraded');

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
  assert.equal(calls.sent.length, 3, 'and the cards are written at once');
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
  removedRow = row({ daily_message_id: 'd', weekly_message_id: 'w', monthly_message_id: 'm' });
  reset();
  log = await run('remove', { type: 'chat' });
  assert.deepEqual([...calls.deleted].sort(), ['d', 'm', 'w'], 'its messages are deleted');
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
  assert.equal(calls.sent.length >= 2, true, 'both boards are written again');
  log = await run('refresh');
  assert.ok(said(log.replies[0]).includes('Wait a minute'), 'one refresh a minute for each server');

  // ---- the pieces are in place
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(/create table if not exists activity_leaderboards/.test(read('src/db/schema.sql')), 'the table');
  assert.ok(/alter table activity_leaderboards add column if not exists periods text\[\] not null default '\{monthly,weekly,daily\}'/.test(read('src/db/schema.sql')), 'the periods, and the boards that existed keep all three');
  assert.ok(/startActivityLeaderboardJob\(client\)/.test(read('index.js')), 'the job starts');
  assert.ok(!/content/.test(read('src/db/activityLeaderboards.ts').replace(/content-type/g, '').replace(/what was said/g, '')), 'nothing about what was said is read');
  console.log('Activity leaderboard checks passed (periods, the card, writing and editing, the reasons it fails, who is in the top, the job, the command).');
})().catch((err) => { console.error(err); process.exit(1); });

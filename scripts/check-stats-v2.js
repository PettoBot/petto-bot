// Checks the statistics v2: the numbers (a period against the one before, the week by hour, tops, growth, one member), the pictures of `!stats` in
// the three languages, what may be counted (a server that turned it off, a person who opted out, no counts per member), and, when
// PETTO_TEST_DATABASE_URL points to a test database, the rules, the deletes, the pruning and the reads against a real PostgreSQL.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL = process.env.PETTO_TEST_DATABASE_URL || 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { botDay } = require('../src/utils/botTime');

const stats = require('../src/utils/statsV2');
const lines = require('../src/utils/statsLines');
const { lifespanBucket } = require('../src/db/activityDetail');

const NOW = new Date('2026-10-26T15:00:00Z');
const day = (back) => botDay(new Date(NOW.getTime() - back * 86_400_000));

(async () => {
  // --- the numbers ---------------------------------------------------------------------------------------------------------------------------
  assert.equal(stats.percentChange(150, 100), 50);
  assert.equal(stats.percentChange(50, 100), -50);
  assert.equal(stats.percentChange(5, 0), null, 'nothing before: there is no percent');
  assert.equal(stats.percentChange(0, 0), 0);
  const w = stats.windows(7, NOW);
  assert.equal(w.current.length, 7);
  assert.equal(w.previous.length, 7);
  assert.equal(w.current[6], day(0));
  assert.equal(w.previous[6], day(7), 'the period before ends the day before this one starts');

  const channelRows = [];
  const hourlyRows = [];
  const flowRows = [];
  const contentRows = [];
  const lifespanRows = [];
  const memberDaily = [];
  for (let back = 0; back < 14; back += 1) {
    const now = back < 7;
    channelRows.push({ channel_id: 'a', day: day(back), messages: now ? 100 : 50, reactions: 5, voice_seconds: 600 });
    channelRows.push({ channel_id: 'b', day: day(back), messages: 20, reactions: 0, voice_seconds: 0 });
    hourlyRows.push({ day: day(back), hour: 21, messages: 60, voice_seconds: 0 });
    flowRows.push({ day: day(back), joins: now ? 4 : 2, leaves: 1, invited: 1 });
    contentRows.push({ day: day(back), links: 12, attachments: 24, replies: 36, mentions: 6 });
    lifespanRows.push({ day: day(back), bucket: back % 5, members: 1 });
    memberDaily.push({ day: day(back), active: 10 });
  }
  const memberTotals = [{ user_id: 'u1', messages: 490, voice_seconds: 2100, active_days: 7 }, { user_id: 'u2', messages: 210, voice_seconds: 0, active_days: 7 }];
  const result = stats.buildStatsV2({ days: 7, now: NOW, channelRows, hourlyRows, flowRows, contentRows, lifespanRows, memberDaily, memberTotals, activeDistinct: { current: 12, previous: 9 }, memberTotal: 500 });
  assert.equal(result.current.totals.messages, 840);
  assert.equal(result.previous.totals.messages, 490);
  assert.equal(result.change.messages, 71.4, 'messages grew 71.4% against the period before');
  assert.equal(result.current.totals.activeMembers, 12);
  assert.equal(result.change.activeMembers, 33.3);
  assert.equal(result.current.totals.joins, 28);
  assert.equal(result.change.joins, 100);
  assert.equal(result.current.totals.net, 21);
  assert.equal(result.change.leaves, 0);
  assert.equal(result.growth.memberLine.at(-1), 500, 'the line ends at the members of today');
  assert.equal(result.growth.memberLine[0], 500 - result.current.series.net.slice(1).reduce((a, b) => a + b, 0));
  assert.ok(result.peak && result.peak.hour === 21, 'the busiest hour');
  assert.equal(result.peak.value, 60);
  assert.equal(result.byHour[21], 60 * 7);
  assert.ok(Math.abs(result.dayparts[3] - 1) < 1e-9, 'all of it in the evening');
  assert.equal(result.topChannels.messages[0].id, 'a');
  assert.ok(Math.abs(result.topChannels.messages[0].share - 700 / 840) < 1e-9);
  assert.equal(result.topChannels.voice.length, 1, 'a channel with no voice is not listed for voice');
  assert.equal(result.topMembers.messages[0].id, 'u1');
  assert.ok(Math.abs(result.topMembers.concentration.top1 - 0.7) < 1e-9);
  assert.equal(result.growth.lifespanTotal, 7);
  assert.ok(result.growth.earlyLeaveShare !== null);
  assert.equal(result.content.per100('links'), Math.round((12 * 7 / 840) * 1000) / 10);

  // A server with nothing counted gives zeros, not errors.
  const empty = stats.buildStatsV2({ days: 7, now: NOW });
  assert.equal(empty.current.totals.messages, 0);
  assert.equal(empty.change.messages, 0);
  assert.equal(empty.peak, null);
  assert.equal(empty.growth.earlyLeaveShare, null);
  assert.equal(empty.topMembers.concentration.members, 0);

  // Quiet channels, streaks and one member.
  assert.deepEqual(stats.quietChannels(['a', 'b', 'c'], channelRows, 7, NOW), ['c']);
  assert.equal(stats.currentStreak([day(0), day(1), day(2), day(4)], day(0)), 3);
  assert.equal(stats.currentStreak([day(1), day(2)], day(0)), 2, 'the day is not over: yesterday still counts');
  assert.equal(stats.currentStreak([day(3)], day(0)), 0);
  const userRows = [];
  for (let back = 0; back < 14; back += 1) userRows.push({ day: day(back), messages: back < 7 ? 70 : 35, voice_seconds: back < 7 ? 300 : 0 });
  const member = stats.buildMemberStats({ userId: 'u1', days: 7, now: NOW, userRows, memberTotals });
  assert.equal(member.counted, true);
  assert.equal(member.totals.messages, 490);
  assert.equal(member.change.messages, 100);
  assert.equal(member.activeDays, 7);
  assert.equal(member.streak, 7);
  assert.deepEqual(member.rank.messages, { rank: 1, of: 2 });
  assert.deepEqual(member.rank.voice, { rank: 1, of: 1 });
  assert.ok(Math.abs(member.share.messages - 0.7) < 1e-9);
  const nobody = stats.buildMemberStats({ userId: 'u9', days: 7, now: NOW, userRows: [], memberTotals });
  assert.equal(nobody.rank.messages, null);
  assert.equal(nobody.totals.messages, 0);
  assert.equal(stats.buildMemberStats({ userId: 'u1', days: 7, now: NOW, userRows: [], memberTotals: [] }).counted, false, 'no counts per member: the answer says so');

  // The group of a stay.
  const DAY = 86_400_000;
  assert.deepEqual([0.5, 3, 20, 60, 400].map((days) => lifespanBucket(days * DAY)), [0, 1, 2, 3, 4]);

  // The lines under the pictures.
  for (const lang of ['en', 'es', 'pt-BR']) {
    const overview = lines.describeStats('overview', result, lang);
    assert.ok(overview.length >= 2 && overview.every((line) => !/info\.stats\./.test(line)), `${lang} overview lines`);
    assert.ok(/60|21:00/.test(overview[0]), 'the busiest time is named');
    assert.ok(lines.quietLine(['1', '2'], lang).includes('<#1>'));
    assert.ok(lines.quietLine(Array.from({ length: 12 }, (_, i) => String(i)), lang).includes('4'), 'how many more');
    assert.ok(lines.quietLine([], lang).length > 5);
  }

  // --- the pictures --------------------------------------------------------------------------------------------------------------------------
  const cards = require('../src/imgutils/statsCards');
  const png = (buffer) => buffer.length > 8_000 && buffer.subarray(1, 4).toString() === 'PNG';
  for (const lang of ['en', 'es', 'pt-BR']) {
    assert.ok(png(cards.buildTrendCard({ guildName: 'Petto', days: 7, stats: result, lang })), `${lang} trend`);
    assert.ok(png(cards.buildHeatmapCard({ guildName: 'Petto', days: 7, stats: result, lang })), `${lang} heatmap`);
    assert.ok(png(cards.buildTopCard({ guildName: 'Petto', days: 7, kind: 'channels', messages: [{ label: '#general', value: 700, share: 0.83 }], voice: [], note: null, lang })), `${lang} top`);
    assert.ok(png(cards.buildGrowthCard({ guildName: 'Petto', days: 7, stats: result, lang })), `${lang} growth`);
    assert.ok(png(cards.buildCompareCard({ guildName: 'Petto', days: 7, stats: result, lang })), `${lang} compare`);
    assert.ok(png(await cards.buildMemberCard({ guildName: 'Petto', name: 'liam', member, lang })), `${lang} member`);
    // Empty servers draw too.
    assert.ok(png(cards.buildTrendCard({ guildName: 'Petto', days: 30, stats: empty, lang })), `${lang} empty trend`);
    assert.ok(png(cards.buildHeatmapCard({ guildName: 'Petto', days: 30, stats: empty, lang })), `${lang} empty heatmap`);
    assert.ok(png(cards.buildGrowthCard({ guildName: 'Petto', days: 30, stats: empty, lang })), `${lang} empty growth`);
  }

  // --- what may be counted -------------------------------------------------------------------------------------------------------------------
  const rules = require('../src/db/statsRules');
  const SERVER = 'guild-1';
  const OFF = 'guild-off';
  const NOMEMBERS = 'guild-nomembers';
  const NOCONTENT = 'guild-nocontent';
  rules.setForTests({
    configs: new Map([[OFF, { enabled: false, members: true, content: true }], [NOMEMBERS, { enabled: true, members: false, content: true }], [NOCONTENT, { enabled: true, members: true, content: false }]]),
    optedOut: new Set(['shy']),
  });
  assert.deepEqual(rules.allowed(SERVER, 'anyone'), { members: true, content: true });
  assert.equal(rules.allowed(OFF, 'anyone'), null, 'a server that turned it off counts nothing');
  assert.equal(rules.allowed(SERVER, 'shy'), null, 'a person who opted out is not counted anywhere');
  assert.equal(rules.allowed(OFF, null), null);
  assert.deepEqual(rules.allowed(NOMEMBERS, 'anyone'), { members: false, content: true });
  assert.deepEqual(rules.allowed(NOCONTENT, 'anyone'), { members: true, content: false });
  assert.equal(rules.isOptedOut('shy'), true);

  // The events write only what the rules allow.
  const written = [];
  const stub = (relative, exports) => {
    const resolved = require.resolve(path.join(__dirname, '..', relative));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  stub('src/db/activityStats.js', { queueActivity: (...args) => written.push(['activity', ...args]), flushActivity: async () => {}, getActivitySummary: async () => [] });
  const realDetail = require('../src/db/activityDetail');
  stub('src/db/activityDetail.js', { ...realDetail, queueMessage: (...args) => written.push(['message', ...args]), queueContent: (...args) => written.push(['content', ...args]), queueVoice: (...args) => written.push(['voice', ...args]), queueFlow: (...args) => written.push(['flow', ...args]), queueLifespan: (...args) => written.push(['lifespan', ...args]) });
  const messageEvent = require('../src/events/messageCreateActivityStats');
  const sendMessage = (guildId, userId, extra = {}) => messageEvent.execute({ author: { id: userId, bot: false }, guild: { id: guildId }, channel: { id: 'c1' }, content: 'hello https://example.com', attachments: { size: 1 }, reference: { messageId: '9' }, mentions: { users: { size: 1 } }, ...extra });
  const kinds = () => written.splice(0).map(([kind]) => kind);
  sendMessage(SERVER, 'u1');
  assert.deepEqual(kinds(), ['activity', 'message', 'content']);
  sendMessage(OFF, 'u1');
  sendMessage(SERVER, 'shy');
  assert.deepEqual(kinds(), [], 'nothing from a server that is off or from a person who opted out');
  sendMessage(NOMEMBERS, 'u1');
  assert.deepEqual(written.map((entry) => [entry[0], entry[3]?.member]).filter(([kind]) => kind === 'message'), [['message', false]], 'the hour is counted, the member is not');
  written.length = 0;
  sendMessage(NOCONTENT, 'u1');
  assert.deepEqual(kinds(), ['activity', 'message'], 'no content counters when they are off');
  sendMessage(SERVER, 'u1', { content: 'hello', attachments: { size: 0 }, reference: null, mentions: { users: { size: 0 } } });
  assert.deepEqual(written.find(([kind]) => kind === 'content')[2], { links: 0, attachments: 0, replies: 0, mentions: 0 }, 'a plain message has no content counters');
  written.length = 0;
  messageEvent.execute({ author: { id: 'u1', bot: true }, guild: { id: SERVER }, channel: { id: 'c1' }, content: '', attachments: { size: 0 }, mentions: { users: { size: 0 } } });
  assert.deepEqual(kinds(), [], 'bots are not counted');

  // The reaction, voice, join and leave counters follow the same rules.
  const reactionEvent = require('../src/events/messageReactionAddActivityStats');
  await reactionEvent.execute({ partial: false, message: { guild: { id: SERVER }, channelId: 'c1' } }, { id: 'u1', bot: false });
  await reactionEvent.execute({ partial: false, message: { guild: { id: SERVER }, channelId: 'c1' } }, { id: 'shy', bot: false });
  await reactionEvent.execute({ partial: false, message: { guild: { id: OFF }, channelId: 'c1' } }, { id: 'u1', bot: false });
  assert.deepEqual(kinds(), ['activity'], 'one reaction counted of three');

  const { processGuild } = require('../src/jobs/activityStatsJob');
  const voiceMember = (id) => ({ id, user: { bot: false } });
  const voiceGuild = (id) => ({ id, afkChannelId: null, channels: { cache: new Map([['v1', { id: 'v1', isVoiceBased: () => true, members: new Map([['u1', voiceMember('u1')], ['shy', voiceMember('shy')]]) }]]) } });
  await processGuild(voiceGuild(SERVER));
  assert.deepEqual(written.filter(([kind]) => kind === 'voice').map((entry) => entry[2]), ['u1'], 'the person who opted out is not counted in voice');
  assert.equal(written.find(([kind]) => kind === 'activity')[3].voiceSeconds, 60, 'and does not add to the time of the channel either');
  written.length = 0;
  await processGuild(voiceGuild(OFF));
  assert.deepEqual(kinds(), []);

  const inviteDb = require('../src/db/inviteTracking');
  inviteDb.recordLeave = async () => null;
  const leaveEvent = require('../src/events/guildMemberRemoveInviteTracking');
  await leaveEvent.execute({ id: 'u1', user: { bot: false }, guild: { id: SERVER }, joinedTimestamp: Date.now() - 3 * DAY });
  assert.deepEqual(kinds(), ['flow', 'lifespan']);
  await leaveEvent.execute({ id: 'shy', user: { bot: false }, guild: { id: SERVER }, joinedTimestamp: Date.now() - 3 * DAY });
  await leaveEvent.execute({ id: 'u1', user: { bot: false }, guild: { id: OFF }, joinedTimestamp: Date.now() - 3 * DAY });
  assert.deepEqual(kinds(), []);

  // --- the command ---------------------------------------------------------------------------------------------------------------------------
  const command = require('../src/commands/info/stats');
  assert.equal(command.parseDays('30'), 30);
  assert.equal(command.parseDays('45d'), 45);
  assert.equal(command.parseDays('999'), 180, 'at most 180 days: compare needs the same number before');
  assert.equal(command.parseDays('0'), 1);
  assert.equal(command.parseDays('abc'), 7);
  assert.equal(command.parseDays(null, 14), 14);
  assert.equal(command.prefixDefaultSubcommand([]), 'server');
  assert.equal(command.prefixDefaultSubcommand(['30d']), 'server');
  assert.equal(command.prefixDefaultSubcommand(['<@123456789012345678>']), 'member');
  assert.equal(command.prefixDefaultSubcommand(['heatmap']), null, 'a word is left to the subcommands');
  const names = command.data.toJSON().options.map((option) => option.name);
  assert.deepEqual(names, ['server', 'channels', 'members', 'heatmap', 'growth', 'compare', 'member', 'privacy']);
  assert.ok(!require('../src/commands/info/summary').aliases.includes('stats'), '!stats is the new command now');

  // The privacy panel has the buttons of the person, and the right one for their state.
  const { buildPrivacyPanel } = require('../src/utils/statsPanels');
  for (const lang of ['en', 'es', 'pt-BR']) {
    const counted = JSON.parse(JSON.stringify(buildPrivacyPanel({ userId: '42', optedOut: false, lang })));
    const ids = counted.components[1].components.map((button) => button.custom_id);
    assert.deepEqual(ids, ['stats:optout:42', 'stats:delete:42']);
    const left = JSON.parse(JSON.stringify(buildPrivacyPanel({ userId: '42', optedOut: true, done: 'Done', lang })));
    assert.deepEqual(left.components[1].components.map((button) => button.custom_id), ['stats:optin:42', 'stats:delete:42']);
    assert.ok(JSON.stringify(left).includes('petto.sbs/privacy#statistics'), 'it links the privacy policy');
  }

  // --- the database --------------------------------------------------------------------------------------------------------------------------
  if (!process.env.PETTO_TEST_DATABASE_URL) {
    console.log('check-stats-v2: ok (the database part was skipped: set PETTO_TEST_DATABASE_URL to a test database to run it)');
    process.exit(0);
  }
  const { getPrimaryPool, closePools } = require('../src/db/postgres');
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  delete require.cache[require.resolve('../src/db/statsRules')];
  delete require.cache[require.resolve('../src/db/activityDetail')];
  const realRules = require('../src/db/statsRules');
  const { readServerStats, readMemberStats } = require('../src/db/statsQueries');
  const G = '910000000000000001';
  const G2 = '910000000000000002';
  const U1 = '920000000000000001';
  const U2 = '920000000000000002';
  for (const guild of [G, G2]) await pool.query('insert into guilds (guild_id) values ($1) on conflict do nothing', [guild]);
  const clean = async () => {
    for (const table of ['activity_stats', 'activity_hourly', 'activity_members', 'member_flow', 'activity_content', 'member_lifespan', 'stats_config']) await pool.query(`delete from ${table} where guild_id = any($1)`, [[G, G2]]);
    await pool.query('delete from stats_optout where user_id = any($1)', [[U1, U2]]);
  };
  await clean();

  // The rules: nothing is counted until they are read, and then they follow the tables.
  assert.equal(realRules.allowed(G, U1), null, 'before the rules are read, nothing is counted');
  await realRules.setConfig(G2, { enabled: false });
  assert.deepEqual(await realRules.getConfig(G), { enabled: true, members: true, content: true }, 'a server that changed nothing counts everything');
  assert.deepEqual(await realRules.getConfig(G2), { enabled: false, members: true, content: true });
  await realRules.setConfig(G2, { members: false });
  assert.deepEqual(await realRules.getConfig(G2), { enabled: false, members: false, content: true }, 'changing one rule keeps the others');
  await realRules.setOptOut(U2, true);
  await realRules.load();
  assert.deepEqual(realRules.allowed(G, U1), { members: true, content: true });
  assert.equal(realRules.allowed(G2, U1), null);
  assert.equal(realRules.allowed(G, U2), null);
  await realRules.setConfig(G2, { enabled: true, members: true });

  // The counters of two servers and two members, over the period and the one before it.
  const insert = async (back, guild, user, messages, voice) => {
    await pool.query('select increment_activity_member($1, $2, $3, $4, $5)', [guild, day(back), user, messages, voice]);
    await pool.query('select increment_activity_stat($1, $2, $3, $4, 0, $5)', [guild, 'c1', day(back), messages, voice]);
    await pool.query('select increment_activity_hourly($1, $2, 21, $3, $4)', [guild, day(back), messages, voice]);
  };
  for (let back = 0; back < 14; back += 1) {
    await insert(back, G, U1, back < 7 ? 70 : 35, back < 7 ? 300 : 0);
    await insert(back, G, U2, 30, 0);
    await insert(back, G2, U1, 5, 0);
    await pool.query('select increment_activity_content($1, $2, 1, 2, 3, 4)', [G, day(back)]);
    await pool.query('select increment_member_lifespan($1, $2, $3, 1)', [G, day(back), back % 5]);
    await pool.query('select increment_member_flow($1, $2, 3, 1, 1)', [G, day(back)]);
  }
  const read = await readServerStats(G, 7, { now: NOW });
  const built = stats.buildStatsV2({ days: 7, now: NOW, ...read });
  assert.equal(built.current.totals.messages, (70 + 30) * 7);
  assert.equal(built.previous.totals.messages, (35 + 30) * 7);
  assert.equal(built.change.messages, 53.8);
  assert.equal(built.current.totals.activeMembers, 2);
  assert.equal(built.previous.totals.activeMembers, 2);
  assert.deepEqual(built.current.series.activeMembers, [2, 2, 2, 2, 2, 2, 2]);
  assert.equal(built.topMembers.messages[0].id, U1);
  assert.equal(built.current.totals.links, 7);
  assert.equal(built.current.totals.attachments, 14);
  assert.equal(built.growth.lifespanTotal, 7, 'the stay groups of the period only');
  assert.equal(built.peak.hour, 21);
  const without = await readServerStats(G, 7, { perMember: false, now: NOW });
  assert.deepEqual(without.memberTotals, []);
  assert.equal(without.activeDistinct, null);
  const one = await readMemberStats(G, U1, 7, { now: NOW });
  const personal = stats.buildMemberStats({ userId: U1, days: 7, now: NOW, ...one });
  assert.equal(personal.totals.messages, 490);
  assert.equal(personal.previous.messages, 245);
  assert.equal(personal.change.messages, 100);
  assert.deepEqual(personal.rank.messages, { rank: 1, of: 2 });
  assert.equal(personal.streak, 7);

  // Opting out deletes what was counted per member about the person, in every server, and nothing of the others.
  await pool.query('select increment_activity_member($1, $2, $3, 4, 0)', [G2, day(0), U2]);
  await realRules.setOptOut(U2, true);
  assert.equal(Number((await pool.query('select count(*) from activity_members where user_id = $1', [U2])).rows[0].count), 0);
  assert.ok(Number((await pool.query('select count(*) from activity_members where user_id = $1', [U1])).rows[0].count) > 0, 'the others stay');
  assert.equal(realRules.isOptedOut(U2), true);
  assert.equal(Number((await pool.query('select count(*) from stats_optout where user_id = $1', [U2])).rows[0].count), 1);
  await realRules.setOptOut(U2, false);
  assert.equal(realRules.isOptedOut(U2), false);

  // Deleting the days of one person; deleting a whole server leaves the other.
  assert.equal(await realRules.deleteMemberCounts(U1), 28, 'the days of counts about them');
  await realRules.deleteGuildCounts(G);
  for (const table of ['activity_stats', 'activity_hourly', 'activity_members', 'member_flow', 'activity_content', 'member_lifespan']) {
    assert.equal(Number((await pool.query(`select count(*) from ${table} where guild_id = $1`, [G])).rows[0].count), 0, `${table} of the deleted server`);
  }
  assert.ok(Number((await pool.query('select count(*) from activity_stats where guild_id = $1', [G2])).rows[0].count) > 0, 'the other server keeps its counters');

  // Pruning: per member 13 months, totals 2 years.
  const old = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  await pool.query('select increment_activity_member($1, $2, $3, 1, 0)', [G2, old(500), U1]);
  await pool.query('select increment_activity_member($1, $2, $3, 1, 0)', [G2, old(300), U1]);
  await pool.query('select increment_activity_stat($1, $2, $3, 1, 0, 0)', [G2, 'c1', old(500)]);
  await pool.query('select increment_activity_stat($1, $2, $3, 1, 0, 0)', [G2, 'c1', old(800)]);
  await realRules.pruneOld();
  assert.equal(Number((await pool.query('select count(*) from activity_members where guild_id = $1 and day = $2', [G2, old(500)])).rows[0].count), 0, 'member counts older than 13 months are gone');
  assert.equal(Number((await pool.query('select count(*) from activity_members where guild_id = $1 and day = $2', [G2, old(300)])).rows[0].count), 1);
  assert.equal(Number((await pool.query('select count(*) from activity_stats where guild_id = $1 and day = $2', [G2, old(500)])).rows[0].count), 1, 'the totals of a day last two years');
  assert.equal(Number((await pool.query('select count(*) from activity_stats where guild_id = $1 and day = $2', [G2, old(800)])).rows[0].count), 0);

  // The guild goes: its config and counters go with it (on delete cascade).
  await pool.query('delete from guilds where guild_id = any($1)', [[G, G2]]);
  assert.equal(Number((await pool.query('select count(*) from stats_config where guild_id = any($1)', [[G, G2]])).rows[0].count), 0);
  await clean();
  await closePools();
  console.log('check-stats-v2: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

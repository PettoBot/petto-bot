// The measurements of the bot (utils/perf.js), the request pipeline to Discord (utils/sharedRestLimit.js) and the private `!perf` tool, with fakes.
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
const assert = require('node:assert/strict');
const perf = require('../src/utils/perf');
const loadGuard = require('../src/utils/loadGuard');
const redis = require('../src/utils/redis');
const logger = require('../src/utils/logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const warnings = [];
const realWarn = logger.warn;
logger.warn = (...args) => { warnings.push(args.join(' ')); };

(async () => {
  // Windows and route families.
  const window = perf.createWindow(5);
  for (const value of [10, 20, 30, 40, 1000, 50]) window.push(value);
  const stats = window.stats();
  assert.equal(stats.count, 5, 'a window keeps the last 5');
  assert.equal(stats.max, 1000);
  assert.equal(stats.total, 6);
  assert.equal(perf.routeFamily('post', '/channels/123456789012345678/messages'), 'POST /channels/:id/messages');
  assert.equal(perf.routeFamily('PATCH', 'https://discord.com/api/v10/webhooks/123456789012345678/aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789/messages/@original?wait=true'), 'PATCH /webhooks/:id/:token/messages/@original');
  assert.equal(perf.routeFamily('PUT', '/channels/123456789012345678/messages/223456789012345678/reactions/%F0%9F%91%8D/@me'), 'PUT /channels/:id/messages/:id/reactions/:emoji/@me');

  // The record of a command, and the warning when it is slow.
  perf.reset();
  const context = perf.newContext({ kind: 'event', name: 'interactionCreate/interactionCreate', interactive: true });
  await perf.runWith(context, async () => {
    perf.setCommand('/mod mute');
    perf.recordDb(30);
    perf.recordDb(50);
    perf.recordRest({ family: 'POST /interactions/:id/:token/callback', totalMs: 120, gateMs: 5, netMs: 100 });
    perf.recordRest({ family: 'PATCH /webhooks/:id/:token/messages/@original', totalMs: 2500, gateMs: 2300, netMs: 150 });
  });
  context.startedAt -= 2600;
  perf.finishContext(context);
  const [record] = perf.slowestCommands();
  assert.equal(record.name, '/mod mute');
  assert.equal(record.db.n, 2);
  assert.equal(record.db.ms, 80);
  assert.equal(record.rest.n, 2);
  assert.equal(record.rest.gate, 2305, 'the time in our own queue is told apart from the network');
  assert.ok(record.ack != null && record.ack < 2600, 'the time to the first answer is kept');
  assert.ok(warnings.some((line) => /Slow command \/mod mute/.test(line) && /database 2 queries 80 ms/.test(line) && /Discord 2 requests/.test(line)), 'a command over 2 seconds warns with the breakdown');
  assert.ok(warnings.some((line) => /Slow Discord request PATCH \/webhooks/.test(line) && /our queue 2300 ms/.test(line)), 'a request over 2 seconds warns with the route and the waits');
  const before = warnings.length;
  perf.recordRest({ family: 'PATCH /webhooks/:id/:token/messages/@original', totalMs: 2500, gateMs: 2300, netMs: 150 });
  assert.equal(warnings.length, before, 'the same warning is not repeated inside a minute');

  // REST statistics, rate limits, invalid requests and the clock.
  perf.recordRateLimit({ family: 'PATCH /channels/:id', waitMs: 580_000, scope: 'user', source: 'discord' });
  perf.recordResponse({ family: 'POST /channels/:id/messages', status: 403, dateHeader: new Date(Date.now() + 3_000).toUTCString() });
  perf.recordResponse({ family: 'POST /channels/:id/messages', status: 429 });
  perf.recordInvalidWarning(100);
  const rest = perf.restStats();
  assert.equal(rest.rateLimits.length, 1);
  assert.equal(rest.invalid.totals[403], 1);
  assert.equal(rest.invalid.totals[429], 1);
  assert.ok(rest.clockSkewMs > 2_000 && rest.clockSkewMs < 4_500, `the clock difference is kept (${rest.clockSkewMs})`);
  assert.ok(rest.topRoutes.length > 0 && rest.topCauses.length > 0, 'requests are counted by route and by cause');

  // Listeners: the time that blocks the loop is told apart from the time to finish, and a long block warns.
  const entry = perf.listenerEntry('messageCreate', 'messageCreateTest');
  await perf.measureListener(entry, async () => { const end = Date.now() + 200; while (Date.now() < end) { /* blocks */ } await sleep(30); });
  perf.countEvent('messageCreate');
  perf.countEvent('messageCreate');
  const listeners = perf.listenerStats();
  assert.ok(entry.syncMax >= 190 && entry.wallMax >= entry.syncMax + 20, 'blocked time and total time are kept apart');
  assert.equal(listeners.byMax[0].key, 'messageCreate / messageCreateTest');
  assert.ok(listeners.events.find((event) => event.name === 'messageCreate').total === 2);
  assert.ok(warnings.some((line) => /messageCreate \/ messageCreateTest blocked the event loop for/.test(line)), 'a listener that blocks more than 150 ms warns');

  // Interval jobs are measured without touching them, and the guard can pause them.
  perf.trackIntervals();
  let ran = 0;
  const timer = setInterval(() => { ran += 1; perf.recordDb(5); }, 20);
  await sleep(110);
  clearInterval(timer);
  const job = perf.jobStats().find((each) => each.name === 'check-perf');
  assert.ok(job && job.runs >= 3 && ran >= 3, 'an interval of Petto is a job');
  assert.ok(job.dbPerRun >= 1, 'the queries of a tick are counted for it');
  loadGuard.reset();
  loadGuard.start({ reader: () => ({ loopP99Ms: 900 }), every: 3_600_000 });
  loadGuard.tick();
  const before2 = ran;
  const paused = setInterval(() => { ran += 1; }, 20);
  // `check-perf` is not an essential job, but a degraded bot only pauses the listed ones: it still runs.
  await sleep(70);
  clearInterval(paused);
  assert.ok(ran > before2, 'a job that is not in the list keeps running when degraded');
  loadGuard.reset();

  // The queue to Discord: lanes, deadlines, critical mode, measurements.
  redis.enabled = () => false;
  const { attachSharedRestLimit, priorityOf } = require('../src/utils/sharedRestLimit');
  const sent = [];
  const rest2 = { request: async (options) => { sent.push(options); await sleep(5); return { ok: true }; }, options: {} };
  const gate = attachSharedRestLimit(rest2, 2);
  assert.ok(gate, 'the limit is attached');
  assert.equal(priorityOf({ fullRoute: '/interactions/1/abc/callback' }), 'high', 'an interaction callback goes first');
  assert.equal(priorityOf({ fullRoute: '/channels/1/messages' }), 'normal', 'a background request is normal');
  const interactive = perf.newContext({ kind: 'event', name: 'interactionCreate/x', interactive: true });
  assert.equal(perf.runWith(interactive, () => priorityOf({ fullRoute: '/channels/1/messages' })), 'high', 'what a person waits for goes first');
  const bulk = perf.newContext({ kind: 'event', name: 'interactionCreate/x', interactive: true });
  bulk.rest.n = 30;
  assert.equal(perf.runWith(bulk, () => priorityOf({ fullRoute: '/channels/1/messages' })), 'normal', 'a bulk loop is not a person waiting');
  // Two background requests fill the bucket of 2 a second; an answer still goes at once.
  const started = Date.now();
  const background = [rest2.request({ fullRoute: '/channels/1/messages', method: 'POST' }), rest2.request({ fullRoute: '/channels/2/messages', method: 'POST' }), rest2.request({ fullRoute: '/channels/3/messages', method: 'POST' })];
  await sleep(20);
  await perf.runWith(interactive, () => rest2.request({ fullRoute: '/channels/9/messages', method: 'POST' }));
  assert.ok(Date.now() - started < 300, 'the answer did not wait for the third background request');
  await Promise.all(background);
  assert.ok(Date.now() - started >= 400, 'and the background was paced (2 a second)');
  // A deadline travels with the requests made inside it.
  sent.length = 0;
  await perf.withDeadline(1000, () => rest2.request({ fullRoute: '/channels/5/messages', method: 'POST' }));
  assert.ok(sent[0].signal instanceof AbortSignal, 'a request made inside withDeadline carries its signal');
  // Critical: a request of a job that is not essential is not sent, an essential one is.
  loadGuard.reset();
  loadGuard.start({ reader: () => ({ loopP99Ms: 5000 }), every: 3_600_000 });
  loadGuard.tick();
  const job2 = perf.newContext({ kind: 'job', name: 'feedsJob' });
  await assert.rejects(perf.runWith(job2, () => rest2.request({ fullRoute: '/channels/6/messages', method: 'POST' })), (error) => error.code === 'PETTO_REST_SHED', 'critical: background work does not ask Discord');
  const essentialJob = perf.newContext({ kind: 'job', name: 'expireSanctions' });
  await perf.runWith(essentialJob, () => rest2.request({ fullRoute: '/guilds/1/bans/2', method: 'PUT' }));
  await perf.runWith(interactive, () => rest2.request({ fullRoute: '/channels/7/messages', method: 'POST' }));
  loadGuard.reset();
  const families = perf.restStats().families.map((entry2) => entry2.family);
  assert.ok(families.some((family) => family.startsWith('POST /channels/')), 'every request is measured by route family');

  // `!perf` is a private tool that nobody else hears from, and it answers with what is measured.
  const command = require('../src/commands/utility/perf');
  assert.equal(command.teamOnly, true);
  assert.equal(command.prefixOnly, true);
  assert.equal(command.hiddenFromHelp, true);
  const answers = [];
  const fakeClient = { ws: { ping: 31 }, rest: { get: async () => ({}) } };
  const call = (userId, section, value) => command.execute({ user: { id: userId }, client: fakeClient, options: { getString: (name) => (name === 'section' ? section : value) ?? null }, deferReply: async () => {}, editReply: async (payload) => { answers.push(JSON.stringify(payload)); } });
  await call('999999999999999999', null);
  assert.equal(answers.length, 0, 'nobody else gets an answer');
  const operators = require('../src/utils/autoModControl');
  const config = require('../src/config');
  config.ownerId = '111111111111111111';
  assert.ok(operators.isPettoOperator('111111111111111111'));
  await call('111111111111111111', null);
  for (const word of ['Level', 'Database', 'Discord REST', 'Rate limits', 'Event loop', 'Memory', 'Commands running', 'Watchdog', 'Slowest commands', 'REST probe now']) assert.ok(answers[0].includes(word), `the summary shows ${word}`);
  for (const section of ['rest', 'slow', 'jobs', 'listeners', 'limits', 'probe']) { await call('111111111111111111', section); assert.ok(answers.at(-1).length > 50, `!perf ${section} answers`); }
  await call('111111111111111111', 'level', 'degraded');
  assert.equal(loadGuard.level(), 'degraded', 'the owner forces a level');
  await call('111111111111111111', 'level', 'auto');
  config.developerIds = ['222222222222222222'];
  await call('222222222222222222', 'level', 'critical');
  assert.notEqual(loadGuard.level(), 'critical', 'a developer cannot force a level, only the owner');
  loadGuard.reset();

  logger.warn = realWarn;
  console.log('perf checks passed');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

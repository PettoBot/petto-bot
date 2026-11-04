// The protection of the bot under load, with fake clocks and fake numbers (nothing here touches Discord or a database):
// the buckets of the prefix commands and their exemptions, the cap of commands running at once, the circuit breaker with its hysteresis, what is shed at
// each level (and that nothing essential is), the two lanes and the fail-fast of the queue to Discord, the watchdog decisions and the guards of the process.
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
process.env.PETTO_CMD_LIMITS = 'on';
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const rateLimits = require('../src/utils/rateLimits');
const loadGuard = require('../src/utils/loadGuard');
const { createGate, RestGateError } = require('../src/utils/restGate');
const watchdog = require('../src/utils/watchdog');
const processGuards = require('../src/utils/processGuards');

const clock = (start = 1_000_000) => { let at = start; return { now: () => at, tick: (ms) => { at += ms; } }; };

(async () => {
  // ---------------------------------------------------------------- buckets
  {
    const time = clock();
    const store = rateLimits.createBucketStore({ burst: 5, refillPerSecond: 0.5, now: time.now });
    for (let i = 0; i < 5; i += 1) assert.equal(store.take('u').ok, true, `the burst of 5 passes (${i})`);
    const refused = store.take('u');
    assert.equal(refused.ok, false, 'the sixth is refused');
    assert.ok(refused.retryAfterMs > 1_900 && refused.retryAfterMs <= 2_000, 'one more token comes in 2 seconds');
    time.tick(2_000);
    assert.equal(store.take('u').ok, true, 'a token came back after 2 seconds');
    assert.equal(store.take('u').ok, false, 'and only one');
    assert.equal(store.take('other').ok, true, 'each key has its own bucket');
    time.tick(60_000);
    for (let i = 0; i < 5; i += 1) assert.equal(store.take('u').ok, true, 'it refills up to the burst, never above');
    assert.equal(store.take('u').ok, false);
  }

  // ---------------------------------------------------------------- the limiter of the commands: users, servers, staff, the team, the levels
  {
    const time = clock();
    let level = 'normal';
    const team = new Set(['owner']);
    const drops = [];
    const limiter = rateLimits.createCommandLimiter({
      limits: { userBurst: 5, userRefillSeconds: 2, guildBurst: 20, guildRefillPerSecond: 2, concurrency: 8, queue: 50, staffReserve: 2, queueWaitMs: 10_000 },
      level: () => level, isTeam: (id) => team.has(id), now: time.now, onDrop: (kind) => drops.push(kind),
    });
    const send = (userId, options = {}) => limiter.check({ userId, guildId: 'g1', ...options });
    for (let i = 0; i < 5; i += 1) assert.equal(send('u1').ok, true);
    assert.deepEqual(send('u1'), { ok: false, kind: 'user' }, 'a person is limited at 5 in a burst');
    assert.equal(send('u2').ok, true, 'another person is not');
    for (let i = 0; i < 100; i += 1) assert.equal(send('owner').ok, true, 'the owner and the developers are never limited');
    // A server: many different people cannot flood it.
    const busy = rateLimits.createCommandLimiter({ limits: { userBurst: 5, userRefillSeconds: 2, guildBurst: 20, guildRefillPerSecond: 2, concurrency: 8, queue: 50, staffReserve: 2, queueWaitMs: 10_000 }, now: time.now });
    let passed = 0;
    let kind = null;
    for (let i = 0; i < 60; i += 1) { const verdict = busy.check({ userId: `p${i}`, guildId: 'busy' }); if (verdict.ok) passed += 1; else kind = verdict.kind; }
    assert.equal(passed, 20, 'a server passes its burst of 20 and no more');
    assert.equal(kind, 'guild');
    assert.equal(busy.check({ userId: 'p1', guildId: 'quiet' }).ok, true, 'another server is not affected');
    // Staff: three times the limits, and the server bucket of the staff is apart from the one of the members.
    const staffPassed = Array.from({ length: 20 }, () => busy.check({ userId: 'mod', guildId: 'busy', staff: true }).ok).filter(Boolean).length;
    assert.equal(staffPassed, 15, 'staff pass 3 times the burst of a person (15), even when the server of the members is full');
    // Degraded halves the limits, critical serves only staff and the team.
    level = 'degraded';
    let degradedPassed = 0;
    for (let i = 0; i < 10; i += 1) if (send('u3').ok) degradedPassed += 1;
    assert.equal(degradedPassed, 2, 'degraded: the burst of 5 is halved (2)');
    level = 'critical';
    assert.deepEqual(send('u4'), { ok: false, kind: 'critical' }, 'critical: a member is not served');
    assert.equal(send('mod2', { staff: true }).ok, true, 'critical: staff are');
    assert.equal(send('owner').ok, true, 'critical: the team is');
    assert.ok(drops.includes('user') && drops.includes('critical'), 'the drops are counted by kind');
    // One notice for each person every 30 seconds, and a few for the whole bot.
    assert.equal(limiter.shouldNotify('u1'), true);
    assert.equal(limiter.shouldNotify('u1'), false, 'never one notice for each dropped message');
    time.tick(31_000);
    assert.equal(limiter.shouldNotify('u1'), true, 'after 30 seconds the person may be told again');
    const several = Array.from({ length: 12 }, (_, i) => limiter.shouldNotify(`n${i}`)).filter(Boolean).length;
    assert.ok(several <= 5, 'and at most 5 notices in 10 seconds for the whole bot');
    // Who is staff.
    const member = (...flags) => ({ permissions: { has: (flag) => flags.includes(flag) } });
    assert.equal(rateLimits.isStaffMember(member(PermissionFlagsBits.ManageMessages)), true);
    assert.equal(rateLimits.isStaffMember(member(PermissionFlagsBits.ModerateMembers)), true);
    assert.equal(rateLimits.isStaffMember(member(PermissionFlagsBits.BanMembers)), true);
    assert.equal(rateLimits.isStaffMember(member(PermissionFlagsBits.Administrator)), true);
    assert.equal(rateLimits.isStaffMember(member(PermissionFlagsBits.SendMessages)), false);
    assert.equal(rateLimits.isStaffMember(null), false);
  }

  // ---------------------------------------------------------------- the cap of commands running at once
  {
    const timers = [];
    const semaphore = rateLimits.createSemaphore({ max: 4, queue: 2, staffReserve: 1, maxWaitMs: 10_000, setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; } });
    const first = await Promise.all([1, 2, 3].map(() => semaphore.acquire({})));
    assert.ok(first.every((slot) => slot.ok), 'members use up to max minus the reserve (3 of 4)');
    const fourth = semaphore.acquire({});
    const staff = await semaphore.acquire({ staff: true });
    assert.equal(staff.ok, true, 'the reserved place is for staff and the team');
    const fifth = semaphore.acquire({});
    const sixth = await semaphore.acquire({});
    assert.deepEqual(sixth, { ok: false, reason: 'full' }, 'the line is bounded: beyond 2 waiting a command is dropped');
    assert.equal(semaphore.stats().waiting, 2);
    first[0].release();
    first[0].release(); // releasing twice counts once
    assert.equal(semaphore.stats().running, 3, 'a member waits until the places in use are below max minus the reserve');
    first[1].release();
    assert.equal((await fourth).ok, true, 'a place that frees goes to the first waiting');
    assert.equal(semaphore.stats().running, 3);
    timers.find((timer) => !timer.cleared && timer.ms === 10_000).fn();
    assert.deepEqual(await fifth, { ok: false, reason: 'timeout' }, 'a command that waits too long is dropped');
    assert.ok(semaphore.stats().running <= 4, 'never more than the cap');
    const queued = semaphore.acquire({});
    const staffNow = await semaphore.acquire({ staff: true });
    assert.equal(staffNow.ok, true, 'staff go in at once while the members wait');
    assert.equal(semaphore.stats().waiting, 1);
    first[2].release(); staff.release();
    assert.equal((await queued).ok, true, 'the member goes when there is room');
  }

  // ---------------------------------------------------------------- the circuit breaker
  {
    const time = clock();
    const changes = [];
    const breaker = loadGuard.createBreaker({
      thresholds: { loop: [400, 2000], restWait: [5000, 20000], restQueue: [60, 250], rssPercent: [80, 92] },
      calmMs: 90_000, now: time.now, onChange: (change) => changes.push(`${change.from}>${change.to}`),
    });
    const calm = { loopP99Ms: 20, restWaitMs: 0, restQueued: 0, rssPercent: 40 };
    assert.equal(breaker.evaluate(calm), 'normal');
    assert.equal(breaker.evaluate({ ...calm, loopP99Ms: 500 }), 'degraded', 'it goes up at once');
    assert.match(breaker.state().reason, /event loop p99 500/);
    assert.equal(breaker.evaluate({ ...calm, restWaitMs: 25_000 }), 'critical', 'and straight to critical when it is that bad');
    assert.equal(breaker.evaluate(calm), 'critical', 'a calm look does not bring it down');
    time.tick(60_000);
    assert.equal(breaker.evaluate(calm), 'critical', 'not after 60 seconds either');
    time.tick(31_000);
    assert.equal(breaker.evaluate(calm), 'degraded', 'it goes down one step after 90 seconds of calm');
    time.tick(60_000);
    assert.equal(breaker.evaluate({ ...calm, restQueued: 70 }), 'degraded', 'pressure again keeps it and restarts the calm');
    time.tick(89_000);
    assert.equal(breaker.evaluate(calm), 'degraded');
    time.tick(2_000);
    assert.equal(breaker.evaluate(calm), 'degraded', 'the calm began at the look after the pressure: 90 s are needed from there');
    time.tick(90_000);
    assert.equal(breaker.evaluate(calm), 'normal', 'and back to normal by itself');
    assert.deepEqual(changes, ['normal>degraded', 'degraded>critical', 'critical>degraded', 'degraded>normal'], 'one change at a time, each told once');
    assert.equal(breaker.evaluate({ ...calm, rssPercent: 95 }), 'critical', 'memory counts');
    breaker.force('degraded');
    assert.equal(breaker.evaluate(calm), 'degraded', 'a forced level stays whatever the numbers say');
    breaker.force('auto');
    assert.throws(() => breaker.force('weird'));
  }

  // ---------------------------------------------------------------- what is shed at each level
  {
    loadGuard.reset();
    const alerts = [];
    loadGuard.setAlertSink((alert) => alerts.push(`${alert.from}>${alert.to}`));
    let metrics = { loopP99Ms: 0, restWaitMs: 0, restQueued: 0, rssPercent: 10 };
    loadGuard.start({ reader: () => metrics, every: 3_600_000 });
    assert.equal(loadGuard.level(), 'normal');
    for (const job of ['feedsJob', 'guildSnapshotJob', 'counterJob', 'expireSanctions']) assert.equal(loadGuard.allowsJob(job), true, `${job} runs in normal`);
    assert.equal(loadGuard.allowsEvent('messageCreateLevelXp'), true);
    assert.equal(loadGuard.allowsOptional('image-render'), true);
    assert.equal(loadGuard.stickyFactor(), 1);

    metrics = { ...metrics, loopP99Ms: 900 };
    loadGuard.tick();
    assert.equal(loadGuard.level(), 'degraded');
    for (const job of ['feedsJob', 'guildSnapshotJob', 'counterJob', 'bumpReminderJob', 'discordOps', 'maliciousFeedJob']) assert.equal(loadGuard.allowsJob(job), false, `${job} is paused when degraded`);
    for (const job of ['expireSanctions', 'lockdownJob', 'joinGateJob', 'antiScamJob', 'statusHeartbeatJob', 'giveawayJob', 'reminderJob']) assert.equal(loadGuard.allowsJob(job), true, `${job} keeps running when degraded`);
    for (const file of ['interactionCreate', 'messageCreateCommands', 'messageCreateTicketActivity', 'messageCreateLevelXp', 'guildMemberAddVerification', 'messageCreateAutomod', 'messageDelete', 'guildBanAdd']) assert.equal(loadGuard.allowsEvent(file), true, `${file} is not shed when degraded`);
    for (const file of ['messageUpdatePublishLog', 'pollVoteAddLog', 'stickerCreate']) assert.equal(loadGuard.allowsEvent(file), false, `${file} (a log of low value) is dropped when degraded`);
    assert.equal(loadGuard.allowsOptional('image-render'), false, 'the pictures fall back to plain messages when degraded');
    assert.equal(loadGuard.stickyFactor(), 4, 'sticky messages wait longer');

    metrics = { ...metrics, loopP99Ms: 3000 };
    loadGuard.tick();
    assert.equal(loadGuard.level(), 'critical');
    for (const job of ['expireSanctions', 'lockdownJob', 'joinGateJob', 'antiScamJob']) assert.equal(loadGuard.allowsJob(job), true, `${job} is essential even in critical`);
    for (const job of ['giveawayJob', 'reminderJob', 'feedsJob', 'autoMessageJob']) assert.equal(loadGuard.allowsJob(job), false, `${job} waits in critical`);
    for (const file of ['interactionCreate', 'interactionCreateGuildOps', 'messageCreateCommands', 'messageCreateTicketAi', 'guildMemberAddJail', 'guildMemberAddAntiRaid', 'messageCreateAntiScam', 'channelDeleteAntiNuke', 'ready']) assert.equal(loadGuard.allowsEvent(file), true, `${file} is essential`);
    for (const file of ['messageCreateLevelXp', 'messageCreateSticky', 'guildMemberAddWelcome', 'voiceStateUpdate', 'messageDelete', 'messageCreateCounting']) assert.equal(loadGuard.allowsEvent(file), false, `${file} is dropped in critical`);
    const stats = loadGuard.stats();
    assert.ok(stats.shed['job:feedsJob'] > 0 && stats.shed['event:messageCreateLevelXp'] > 0, 'what is shed is counted by job and by listener');
    assert.deepEqual(alerts, ['normal>degraded', 'degraded>critical'], 'the alert goes once for each change of level');
    loadGuard.force('normal');
    assert.equal(loadGuard.allowsJob('feedsJob'), true, 'everything resumes when the level goes down');

    // The alert of the default path: only going to CRITICAL is a priority error (it pings the team); degraded and coming down are ordinary warnings.
    {
      const logger = require('../src/utils/logger');
      const original = { error: logger.error, warn: logger.warn, localWarn: logger.localWarn };
      const seen = [];
      logger.error = (text) => seen.push(['error', text]);
      logger.warn = (text) => seen.push(['warn', text]);
      logger.localWarn = (text) => seen.push(['local', text]);
      loadGuard.setAlertSink(null);
      try {
        const at = Date.now();
        loadGuard.announce({ from: 'normal', to: 'degraded', reason: 'test', since: at });
        loadGuard.announce({ from: 'degraded', to: 'critical', reason: 'test', since: at });
        loadGuard.announce({ from: 'critical', to: 'degraded', reason: 'test', since: at });
        loadGuard.announce({ from: 'degraded', to: 'normal', reason: 'test', since: at });
      } finally { logger.error = original.error; logger.warn = original.warn; logger.localWarn = original.localWarn; }
      assert.deepEqual(seen.map((entry) => entry[0]), ['local', 'error', 'local', 'local'], 'normal and degraded stay in the console, only critical reaches the team');
    }
    loadGuard.reset();
  }

  // ---------------------------------------------------------------- the queue to Discord: lanes, bounds and fail-fast
  {
    const time = clock(0);
    const timers = [];
    const gate = createGate({ perSecond: 8, maxQueue: 5, failFastMs: 30_000, maxInFlight: 4, now: time.now, setTimer: (fn, ms) => { const timer = { fn, at: time.now() + ms }; timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; } });
    const advance = (ms) => { time.tick(ms); for (const timer of timers.splice(0)) if (!timer.cleared) timer.fn(); };
    // The background lane fills the bucket and the line.
    const waits = [];
    const background = [];
    for (let i = 0; i < 4; i += 1) background.push(gate.acquire('normal'));
    assert.equal(gate.stats().inFlight, 4, 'four go at once');
    const queued = [];
    for (let i = 0; i < 5; i += 1) queued.push(gate.acquire('normal').then((waited) => waits.push(waited), (error) => error));
    await assert.rejects(gate.acquire('normal'), (error) => error instanceof RestGateError && error.code === 'PETTO_REST_QUEUE_FULL', 'the background queue is bounded: the sixth waiting request fails at once');
    // An answer does not wait for the background lane, even with it full.
    const answerStart = time.now();
    const answer = await gate.acquire('high');
    assert.equal(answer, 0, 'an answer to a person goes at once while the background waits');
    assert.equal(time.now(), answerStart);
    assert.ok(gate.stats().queuedNormal === 5, 'the background is still waiting');
    for (let i = 0; i < 12; i += 1) { gate.done(); advance(200); } // the requests in flight end and the line moves
    await Promise.all(queued);
    assert.ok(waits.length > 0, 'the waiting ones go when places free up');
    // Fail fast: a background request that waits too long fails instead of sitting in the line.
    const stuck = createGate({ perSecond: 1, maxQueue: 50, failFastMs: 5_000, maxInFlight: 1, now: time.now, setTimer: (fn, ms) => { const timer = { fn, at: time.now() + ms }; timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; } });
    await stuck.acquire('normal'); // takes the only place and never finishes
    const doomed = stuck.acquire('normal');
    time.tick(6_000);
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.fn();
    await assert.rejects(doomed, (error) => error.code === 'PETTO_REST_WAIT_TIMEOUT', 'a background request that waited past the limit is dropped');
    assert.equal(stuck.stats().failed.wait, 1);
    // A request with a deadline leaves the line when the signal fires.
    const controller = new AbortController();
    const cancelled = stuck.acquire('normal', { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled);
    assert.equal(stuck.stats().queuedNormal, 0, 'a cancelled request is not left in the line');
    // The answers keep their limit: a long debt makes them wait too, which is what keeps the host cap.
    const tight = createGate({ perSecond: 1, debtFactor: 1, now: time.now, setTimer: (fn, ms) => { const timer = { fn, at: time.now() + ms }; timers.push(timer); return timer; }, clearTimer: (timer) => { timer.cleared = true; } });
    assert.equal(await tight.acquire('high'), 0);
    assert.equal(await tight.acquire('high'), 0);
    const third = tight.acquire('high');
    assert.equal(tight.stats().queuedHigh, 1, 'beyond the debt even an answer waits');
    time.tick(2_000);
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.fn();
    await third;
  }

  // ---------------------------------------------------------------- the watchdog
  {
    const limits = { criticalMs: 180_000, blockedMs: 60_000, rssLimitMb: 920, maxRestarts: 3 };
    const base = { level: 'normal', criticalForMs: 0, blockedForMs: 0, rssMb: 300, cachesDropped: false, restartsLastHour: 0 };
    assert.equal(watchdog.decide(base, limits).action, 'none');
    assert.equal(watchdog.decide({ ...base, level: 'critical', criticalForMs: 120_000 }, limits).action, 'none', 'critical for 2 minutes is not enough');
    const critical = watchdog.decide({ ...base, level: 'critical', criticalForMs: 190_000 }, limits);
    assert.equal(critical.action, 'exit');
    assert.match(critical.reason, /critical for 190 s/);
    assert.equal(watchdog.decide({ ...base, blockedForMs: 61_000 }, limits).action, 'exit', 'a blocked loop');
    assert.equal(watchdog.decide({ ...base, rssMb: 950 }, limits).action, 'drop-caches', 'memory: the caches go first');
    assert.equal(watchdog.decide({ ...base, rssMb: 950, cachesDropped: true }, limits).action, 'exit', 'and the process stops when that was not enough');
    assert.equal(watchdog.decide({ ...base, rssMb: 800, cachesDropped: true }, limits).action, 'none');
    const exhausted = watchdog.decide({ ...base, level: 'critical', criticalForMs: 190_000, restartsLastHour: 3 }, limits);
    assert.equal(exhausted.action, 'hold', 'never a restart loop: past 3 restarts an hour it stays critical');
    assert.match(exhausted.reason, /3 restarts already/);
    assert.equal(watchdog.decide({ ...base, level: 'critical', criticalForMs: 190_000, restartsLastHour: 2 }, limits).action, 'exit', 'the third restart is still allowed');
    // The restarts of the last hour come from the database and the file, and old ones are forgotten.
    const now = 10_000_000;
    const fakeDb = { getSetting: async () => JSON.stringify([now - 4_000_000, now - 600_000, now - 100_000]), setSetting: async () => {} };
    const times = await watchdog.loadRestarts({ now, db: fakeDb, file: false });
    assert.deepEqual(times, [now - 600_000, now - 100_000], 'only the restarts of the last hour count');
    assert.deepEqual(watchdog.recent([now - 3_599_000, now - 3_601_000], now), [now - 3_599_000]);
  }

  // ---------------------------------------------------------------- the guards of the process
  {
    const transient = [new Error('Request timed out'), Object.assign(new Error('x'), { code: 'ECONNRESET' }), Object.assign(new Error('Unknown Message'), { name: 'DiscordAPIError', code: 10008, status: 404 }), new RestGateError('PETTO_REST_WAIT_TIMEOUT', 'waited'), Object.assign(new Error('aborted'), { name: 'AbortError' }), Object.assign(new Error('terminated'), { code: '57P01' })];
    for (const error of transient) assert.equal(processGuards.isNonFatal(error), true, `${error.name} ${error.code ?? ''} is only a failed request`);
    for (const error of [new TypeError('x is not a function'), new ReferenceError('y is not defined'), new RangeError('Maximum call stack size exceeded')]) assert.equal(processGuards.isNonFatal(error), false, `${error.name} is a bug and stops the process`);
    const handlers = {};
    const exits = [];
    const proc = { on: (event, handler) => { handlers[event] = handler; }, exit: (code) => exits.push(code) };
    processGuards.installProcessGuards({ exit: async (reason) => { exits.push(reason); }, canExit: () => true, proc });
    handlers.uncaughtException(new Error('Request timed out'));
    assert.deepEqual(exits, [], 'a timeout does not stop the process');
    handlers.uncaughtException(new TypeError('boom'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(exits.length, 1, 'a bug stops it cleanly');
    const kept = [];
    processGuards.installProcessGuards({ exit: async (reason) => { kept.push(reason); }, canExit: () => false, proc });
    handlers.uncaughtException(new TypeError('boom again'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(kept, [], 'past the restarts of the hour it keeps running');
    const listeners = {};
    const client = { on: (event, handler) => { listeners[event] = handler; } };
    const gatewayExits = [];
    processGuards.installGatewayGuards(client, { exit: async (reason) => { gatewayExits.push(reason); } });
    for (const event of ['shardDisconnect', 'shardError', 'invalidated', 'error', 'shardReconnecting', 'shardResume']) assert.equal(typeof listeners[event], 'function', `${event} is handled`);
    listeners.shardDisconnect({ code: 1006 }, 0);
    listeners.shardError(new Error('socket'), 0);
    listeners.error(new Error('client'));
    assert.deepEqual(gatewayExits, [], 'the connection events only log: discord.js reconnects by itself');
    listeners.invalidated();
    assert.equal(gatewayExits.length, 1, 'only an invalidated session stops the process');
  }

  // ---------------------------------------------------------------- the limits only apply in the bot, not in the checks
  assert.equal(rateLimits.limitsApply({}, '/app/index.js'), true);
  assert.equal(rateLimits.limitsApply({}, '/app/scripts/check-x.js'), false);
  assert.equal(rateLimits.limitsApply({ PETTO_CMD_LIMITS: 'off' }, '/app/index.js'), false);
  assert.equal(rateLimits.limitsApply({ PETTO_CMD_LIMITS: 'on' }, '/app/scripts/check-x.js'), true);

  console.log('load protection checks passed');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

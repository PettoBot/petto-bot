// Checks the quarantine (src/utils/quarantine.ts), the rate limit fallback (src/utils/fallback.ts) and how the bot uses them: the event listeners, the interval jobs and the detector of pictures.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { createQuarantine } = require('../src/utils/quarantine');
const { withFallback, isRateLimited, retryAfterMs } = require('../src/utils/fallback');

(async () => {
  // ---- The quarantine on its own, with a clock we move ---------------------------------------------------------------------
  let clock = 1_000_000;
  const changes = [];
  const q = createQuarantine({ now: () => clock, onChange: (change) => changes.push(change) });
  q.protect('event:essential');
  q.protect((key) => key.startsWith('job:vital'));

  for (let i = 0; i < 7; i += 1) assert.equal(q.fail('event:a', new Error('boom')), false, 'seven failures are not enough');
  assert.equal(q.blocked('event:a'), false);
  assert.equal(q.fail('event:a', new Error('boom')), true, 'the eighth failure in the minute puts it apart');
  assert.equal(q.blocked('event:a'), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].state, 'resting');
  assert.match(changes[0].error, /boom/);

  // A part that works most of the time is not put apart by a few errors.
  for (let i = 0; i < 40; i += 1) q.succeed('event:busy');
  for (let i = 0; i < 12; i += 1) q.fail('event:busy', new Error('odd input'));
  assert.equal(q.blocked('event:busy'), false, 'more than half of the runs worked');

  // The rest ends: ONE trial goes through, the others still wait.
  clock += 59_000;
  assert.equal(q.blocked('event:a'), true);
  clock += 2_000;
  assert.equal(q.blocked('event:a'), false, 'the trial run');
  assert.equal(q.blocked('event:a'), true, 'only one trial at a time');
  // A trial that fails sends it back to rest for twice as long.
  assert.equal(q.fail('event:a', new Error('still broken')), true);
  const status = q.status().find((part) => part.key === 'event:a');
  assert.equal(status.restMs, 120_000);
  assert.equal(status.times, 2);
  clock += 119_000;
  assert.equal(q.blocked('event:a'), true);
  clock += 2_000;
  assert.equal(q.blocked('event:a'), false);
  // A trial that works brings it back and forgets the old rest.
  q.succeed('event:a');
  assert.equal(q.blocked('event:a'), false);
  assert.equal(changes.at(-1).state, 'back');
  assert.equal(q.status().find((part) => part.key === 'event:a').restMs, 60_000);

  // A trial that never reports (it hung) does not leave the part stuck for good.
  for (let i = 0; i < 8; i += 1) q.fail('event:hung');
  clock += 61_000;
  assert.equal(q.blocked('event:hung'), false);
  clock += 1;
  assert.equal(q.blocked('event:hung'), true);
  clock += 61_000;
  assert.equal(q.blocked('event:hung'), false, 'another trial after another rest');

  // The failures of a minute ago do not count.
  for (let i = 0; i < 6; i += 1) q.fail('event:slow');
  clock += 61_000;
  for (let i = 0; i < 6; i += 1) q.fail('event:slow');
  assert.equal(q.blocked('event:slow'), false);

  // The essential work is never put apart, and the rest cap holds.
  for (let i = 0; i < 30; i += 1) assert.equal(q.fail('event:essential'), false);
  for (let i = 0; i < 30; i += 1) q.fail('job:vitalJob');
  assert.equal(q.blocked('event:essential'), false);
  assert.equal(q.blocked('job:vitalJob'), false);
  const capped = createQuarantine({ now: () => clock, maxMs: 200_000 });
  for (let i = 0; i < 8; i += 1) capped.fail('x');
  for (let round = 0; round < 5; round += 1) { clock += 1_000_000; capped.blocked('x'); capped.fail('x'); }
  assert.equal(capped.status()[0].restMs, 200_000);
  // By hand.
  assert.equal(capped.release('x'), true);
  assert.equal(capped.blocked('x'), false);
  assert.equal(capped.release('x'), false);

  // ---- The fallback for rate limits ----------------------------------------------------------------------------------------
  assert.equal(isRateLimited({ status: 429 }), true);
  assert.equal(isRateLimited({ httpStatus: 429 }), true);
  assert.equal(isRateLimited(new Error('You are being rate limited')), true);
  assert.equal(isRateLimited(new Error('nope')), false);
  assert.equal(isRateLimited(null), false);
  assert.equal(retryAfterMs({ headers: new Headers({ 'retry-after': '2' }) }), 2000);
  assert.equal(retryAfterMs({ retryAfter: 750 }), 750);
  assert.equal(retryAfterMs({}), 1000);

  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  // A rate limit waits what the service asks and tries again.
  let calls = 0;
  const value = await withFallback(async () => { calls += 1; if (calls === 1) throw Object.assign(new Error('slow down'), { status: 429, retryAfter: 300 }); return 'ok'; }, { sleep });
  assert.equal(value, 'ok'); assert.deepEqual(slept, [300]); assert.equal(calls, 2);
  // A wait that is too long goes straight to the fallback.
  slept.length = 0; calls = 0;
  assert.equal(await withFallback(async () => { calls += 1; throw Object.assign(new Error('x'), { status: 429, retryAfter: 60_000 }); }, { sleep, fallback: () => 'plain' }), 'plain');
  assert.equal(calls, 1); assert.deepEqual(slept, []);
  // Rate limited again after the retry: the fallback.
  calls = 0;
  assert.equal(await withFallback(async () => { calls += 1; throw Object.assign(new Error('x'), { status: 429, retryAfter: 10 }); }, { sleep, fallback: () => 'plain' }), 'plain');
  assert.equal(calls, 2);
  // Without a fallback the error comes out.
  await assert.rejects(withFallback(async () => { throw new Error('plain failure'); }), /plain failure/);
  // The failures of a key feed the quarantine; a rate limit does not; a quarantined key answers the fallback without trying.
  const guard = createQuarantine({ now: () => clock });
  let tried = 0;
  const failing = () => withFallback(async () => { tried += 1; throw new Error('down'); }, { key: 'call:x', quarantine: guard, fallback: () => 'plain' });
  for (let i = 0; i < 12; i += 1) assert.equal(await failing(), 'plain');
  assert.equal(tried, 8, 'after eight failures the service is not called any more');
  assert.equal(guard.blocked('call:x'), true);
  const limited = createQuarantine({ now: () => clock });
  for (let i = 0; i < 20; i += 1) await withFallback(async () => { throw Object.assign(new Error('x'), { status: 429, retryAfter: 99_999 }); }, { key: 'call:y', quarantine: limited, sleep, fallback: () => 'plain' });
  assert.equal(limited.blocked('call:y'), false, 'a rate limit is not a broken part');

  // ---- The event listeners: a listener that keeps failing rests, the others and the essential ones keep running --------------
  const quarantine = require('../src/utils/eventQuarantine');
  const { makeInvoker } = require('../src/handlers/eventHandler');
  quarantine.reset();
  let broken = 0; let healthy = 0; let essential = 0;
  const client = { guilds: { cache: new Map() } };
  const brokenListener = makeInvoker({ name: 'guildMemberAdd', execute: async () => { broken += 1; throw new Error('listener is broken'); } }, 'guildMemberAddBroken.js', client);
  const healthyListener = makeInvoker({ name: 'guildMemberAdd', execute: async () => { healthy += 1; } }, 'guildMemberAddHealthy.js', client);
  const essentialListener = makeInvoker({ name: 'interactionCreate', execute: async () => { essential += 1; throw new Error('essential failing'); } }, 'interactionCreateBroken.js', client);
  const logs = [];
  const logger = require('../src/utils/logger');
  const realError = logger.error; const realWarn = logger.warn;
  logger.error = (...args) => { logs.push(args.join(' ')); }; logger.warn = () => {};
  const member = () => ({ id: '1', guild: { id: '2' }, user: { id: '1' } });
  for (let i = 0; i < 20; i += 1) { brokenListener(member()); healthyListener(member()); essentialListener({ id: String(i), guildId: '2', user: { id: '1' }, isChatInputCommand: () => false }); await new Promise((resolve) => setImmediate(resolve)); }
  await new Promise((resolve) => setTimeout(resolve, 20));
  logger.error = realError; logger.warn = realWarn;
  assert.equal(broken, 8, 'the broken listener ran until it was put apart');
  assert.equal(healthy, 20, 'the healthy one never stopped');
  assert.equal(essential, 20, 'an essential listener is never put apart');
  assert.equal(logs.filter((line) => line.includes('[quarantine]')).length, 1, 'the team is told once');
  assert.ok(quarantine.status().some((part) => part.key === 'event:guildMemberAddBroken' && part.state === 'resting'));
  assert.equal(quarantine.status().some((part) => part.key === 'event:interactionCreateBroken' && part.state === 'resting'), false);

  // ---- The detector of pictures: a 429 is tried again, a service that keeps failing rests, and every case ends as "not checked" ----
  process.env.OPENAI_API_KEY = 'check-key';
  delete process.env.PETTO_IMAGE_SCREEN;
  quarantine.reset();
  const { screen } = require('../src/utils/imageScreen');
  const picture = Buffer.from('x');
  const ok = { ok: true, status: 200, json: async () => ({ results: [{ categories: { sexual: false } }] }) };
  let n = 0;
  const limitedOnce = async () => { n += 1; return n === 1 ? { ok: false, status: 429, headers: new Headers({ 'retry-after': '0.01' }) } : ok; };
  assert.deepEqual(await screen(picture, limitedOnce), { checked: true, minor: false, reasons: [] });
  assert.equal(n, 2);
  n = 0;
  const down = async () => { n += 1; return { ok: false, status: 503, headers: new Headers() }; };
  for (let i = 0; i < 12; i += 1) assert.deepEqual(await screen(picture, down), { checked: false });
  assert.equal(n, 8, 'the detector is left alone while it rests');
  // A picture the service refuses (400) is about the picture and never puts the detector apart.
  quarantine.reset(); n = 0;
  const refuse = async () => { n += 1; return { ok: false, status: 400, headers: new Headers() }; };
  for (let i = 0; i < 12; i += 1) assert.deepEqual(await screen(picture, refuse), { checked: false });
  assert.equal(n, 12);
  quarantine.reset();

  // ---- The interval jobs: a job that keeps failing rests (the name of the job is the file that started the interval) -------------
  const perf = require('../src/utils/perf');
  perf.trackIntervals();
  process.on('unhandledRejection', () => {}); // a failing tick still rejects, as it did before the quarantine
  let jobRuns = 0;
  const handle = setInterval(async () => { jobRuns += 1; throw new Error('job is broken'); }, 5);
  await new Promise((resolve) => setTimeout(resolve, 300));
  clearInterval(handle);
  assert.equal(jobRuns, 8, 'the failing job ran until it was put apart');
  assert.ok(quarantine.status().some((part) => part.key === 'job:check-quarantine' && part.state === 'resting'));
  quarantine.reset();
  console.log('quarantine ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

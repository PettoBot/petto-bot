// `ask`, the AI that answers questions (`!ask`, `petto ask`, `@Petto ask`, `/ai ask`, `/ai usage`), with no network and no database:
//   - the daily limit of a free member is exact (N allowed, N+1 refused with the time it comes back), Premium, the owner and the developers have none, the day
//     changes at UTC midnight, the cooldown is shorter for Premium, the caps of the server and of the bot do not count a use, a failed answer gives its use
//     back, and questions at the same time cannot pass the limit (the statement of the database is guarded: `where ask_usage.used < $3`);
//   - what the model writes is cleaned (nobody is pinged, no invites, never empty, cut at a sentence), and no question or answer reaches a log;
//   - a conversation goes on with a reply of the member who asked (and nobody else), with the context of the reply chain (4 messages back at most);
//   - the rules of a server (!disablecommand, !restrictcommand, a permission level) stop the slash command, the prefix and the follow-up;
//   - not configured, switched off, a word that is everyday speech, the prefix forms and the slash options in the three languages.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const DEV = '900000000000000001';
process.env.PETTO_DEVELOPER_IDS = DEV;
process.env.GROQ_API_KEY = 'check-only-key';
for (const key of Object.keys(process.env)) if (key.startsWith('ASK_')) delete process.env[key];
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, MessageFlags, PermissionsBitField } = require('discord.js');

const root = path.join(__dirname, '..');
const patch = (relative, overrides) => Object.assign(require(path.join(root, relative)), overrides);

// ---------------------------------------------------------------- everything that is recorded in a log (a question or an answer must never be in it)
const logged = [];
const record = (...args) => { logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(' ')); };
patch('src/utils/logger.js', { info: record, warn: record, error: record, debug: record });

const askAi = require('../src/utils/askAi');
const usage = require('../src/db/askUsage');
const ticketAi = require('../src/utils/ticketAi');
const premiumDb = require('../src/db/premium');
const config = require('../src/config');
const { t, tn } = require('../src/i18n');
const { isCommonWord } = require('../src/utils/commonWords');

const SECRET_QUESTION = 'SECRETQUESTION-the-pink-elephant';
const SECRET_ANSWER = 'SECRETANSWER-the-blue-whale';
const ANA = '111111111111111111';
const BEA = '222222222222222222';
const GUILD = '444444444444444444';
const OTHER_GUILD = '444444444444444445';
const ROOM = '666666666666666666';
const BOT = '123';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- a database that does what the statements say, one at a time (so the statements are what is tested)
function fakePool() {
  const rows = new Map();
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === usage.SQL.consume) {
      const [user, day, limit] = params;
      const key = `${user}|${day}`;
      const used = rows.get(key);
      if (used === undefined) { rows.set(key, 1); return { rows: [{ used: 1 }] }; }
      if (used < limit) { rows.set(key, used + 1); return { rows: [{ used: used + 1 }] }; }
      return { rows: [] };
    }
    if (sql === usage.SQL.refund) {
      const [user, day] = params;
      const key = `${user}|${day}`;
      if (rows.get(key) > 0) { rows.set(key, rows.get(key) - 1); return { rows: [{ used: rows.get(key) }] }; }
      return { rows: [] };
    }
    if (sql === usage.SQL.used) return { rows: rows.has(`${params[0]}|${params[1]}`) ? [{ used: rows.get(`${params[0]}|${params[1]}`) }] : [] };
    if (sql === usage.SQL.purge) {
      const limit = Date.parse(params[0]) - 7 * DAY;
      for (const key of [...rows.keys()]) if (Date.parse(key.split('|')[1]) < limit) rows.delete(key);
      return { rows: [] };
    }
    throw new Error(`unexpected statement: ${sql}`);
  };
  return { rows, calls, query, store: usage.createStore(query) };
}
const usedOf = (pool, user, day) => pool.rows.get(`${user}|${day}`) ?? 0;

let clock = Date.UTC(2026, 10, 1, 12, 0, 0);
const modelCalls = [];
let modelAnswer = { ok: true, content: 'A short answer.' };
const deps = (pool, extra = {}) => ({
  now: () => clock,
  store: pool.store,
  who: async () => ({ unlimited: false, team: false, premium: false }),
  chat: async (messages, max) => { modelCalls.push({ messages, max }); return typeof modelAnswer === 'function' ? modelAnswer(messages) : modelAnswer; },
  ...extra,
});
const reset = () => {
  askAi.resetState();
  for (const key of Object.keys(process.env)) if (key.startsWith('ASK_')) delete process.env[key];
  process.env.GROQ_API_KEY = 'check-only-key';
  process.env.ASK_COOLDOWN_FREE_SECONDS = '0';
  process.env.ASK_COOLDOWN_PREMIUM_SECONDS = '0';
  modelCalls.length = 0;
  modelAnswer = { ok: true, content: 'A short answer.' };
  clock = Date.UTC(2026, 10, 1, 12, 0, 0);
};
const ask = (pool, input = {}, extra = {}) => askAi.ask({ userId: ANA, guildId: GUILD, question: 'what is a cat?', ...input }, deps(pool, extra));

(async () => {
  // ---------------------------------------------------------- 1. the statement is guarded and atomic
  {
    assert.match(usage.SQL.consume, /insert into ask_usage/i, 'one statement inserts the first use of the day');
    assert.match(usage.SQL.consume, /on conflict \(user_id, day\) do update set used = ask_usage\.used \+ 1\s+where ask_usage\.used < \$3/i, 'and adds 1 only WHERE used < the limit, in the same statement (atomic: no read first)');
    assert.match(usage.SQL.consume, /returning used/i, 'a row comes back only when the use was counted');
    assert.doesNotMatch(usage.SQL.consume, /^\s*select/i, 'the count is not read and then written');
    assert.match(usage.SQL.refund, /used > 0/, 'a use is never given back below 0');
    const schema = fs.readFileSync(path.join(root, 'src', 'db', 'schema.sql'), 'utf8');
    assert.match(schema, /create table if not exists ask_usage \(\s*user_id text\s+not null,\s*day\s+date\s+not null,\s*used\s+integer not null default 0 check \(used >= 0\),\s*primary key \(user_id, day\)\s*\);/, 'the table is in schema.sql, idempotent, with the key (user_id, day)');
    assert.doesNotMatch(schema.slice(schema.indexOf('create table if not exists ask_usage')).split(');')[0], /question|answer|content|message/i, 'the table holds a number, never a question or an answer');
  }

  // ---------------------------------------------------------- 2. the free limit is exact, and tells when it comes back
  {
    reset();
    process.env.ASK_FREE_DAILY = '3';
    const pool = fakePool();
    const day = askAi.dayOf(clock);
    const left = [];
    for (let i = 0; i < 3; i += 1) { const r = await ask(pool); assert.equal(r.status, 'ok', `question ${i + 1} of 3 is answered`); left.push(r.remaining); }
    assert.deepEqual(left, [2, 1, 0], 'the answer says how many are left');
    const refused = await ask(pool);
    assert.equal(refused.status, 'limit', 'the 4th is refused');
    assert.equal(refused.limit, 3);
    assert.equal(refused.resetAt, Date.UTC(2026, 10, 2), 'with the time it comes back: the next UTC midnight');
    assert.equal(modelCalls.length, 3, 'the model was not asked the 4th');
    assert.equal(usedOf(pool, ANA, day), 3, 'nothing was counted for the refused one');
    assert.equal((await ask(pool, { userId: BEA })).status, 'ok', 'the limit is for each member');
    // The default is 10, and the values of the environment are read when they are used.
    reset();
    assert.equal(askAi.limits().freeDaily, 10);
    assert.deepEqual([askAi.limits().guildPerHour, askAi.limits().globalPerMinute], [60, 25]);
    delete process.env.ASK_COOLDOWN_FREE_SECONDS; delete process.env.ASK_COOLDOWN_PREMIUM_SECONDS;
    assert.deepEqual([askAi.limits().cooldownFreeMs, askAi.limits().cooldownPremiumMs], [15_000, 5_000]);
    process.env.ASK_FREE_DAILY = 'banana';
    assert.equal(askAi.limits().freeDaily, 10, 'a value that is not a number is the default');
    process.env.ASK_FREE_DAILY = '0';
    assert.equal(askAi.limits().freeDaily, 1, 'and 0 is never "no question at all"');
  }

  // ---------------------------------------------------------- 3. Premium, the owner and the developers have no limit; the account is what counts
  {
    reset();
    process.env.ASK_FREE_DAILY = '2';
    const pool = fakePool();
    const premium = { unlimited: true, team: false, premium: true };
    let last;
    for (let i = 0; i < 25; i += 1) last = await ask(pool, {}, { who: async () => premium });
    assert.equal(last.status, 'ok', 'Premium: more than the free limit');
    assert.equal(last.remaining, null, 'and nothing is said about what is left');
    assert.equal(pool.calls.filter((call) => call.sql === usage.SQL.consume).length, 0, 'nothing is counted for Premium');
    // who is who, with the real lookup
    const original = premiumDb.getUserPremium;
    try {
      const premiumUsers = new Set([BEA]);
      premiumDb.getUserPremium = async (id) => ({ active: premiumUsers.has(id) });
      askAi.resetState();
      assert.deepEqual(await askAi.whoIs(BEA), { unlimited: true, team: false, premium: true }, 'an account with Premium has no limit');
      assert.deepEqual(await askAi.whoIs(ANA), { unlimited: false, team: false, premium: false }, 'a free account has it');
      assert.equal((await askAi.whoIs(config.ownerId)).unlimited, true, 'the owner has none');
      assert.equal((await askAi.whoIs(DEV)).unlimited, true, 'a developer (PETTO_DEVELOPER_IDS) has none');
      assert.equal((await askAi.whoIs(DEV)).team, true);
      premiumUsers.delete(BEA);
      assert.equal((await askAi.whoIs(BEA)).unlimited, true, 'the answer about Premium is kept for a minute');
      askAi.resetState();
      assert.equal((await askAi.whoIs(BEA)).unlimited, false, 'and then it is asked again');
      premiumDb.getUserPremium = async () => { throw new Error('database down'); };
      askAi.resetState();
      assert.equal((await askAi.whoIs(BEA)).unlimited, false, 'if Premium cannot be read the member is limited, never given more');
    } finally { premiumDb.getUserPremium = original; }
    reset();
    const devPool = fakePool();
    for (let i = 0; i < 15; i += 1) assert.equal((await ask(devPool, { userId: DEV }, { who: askAi.whoIs })).status, 'ok');
    assert.equal(devPool.calls.length, 0, 'a developer is not counted in the database');
  }

  // ---------------------------------------------------------- 4. the day changes at UTC midnight
  {
    reset();
    process.env.ASK_FREE_DAILY = '2';
    const pool = fakePool();
    clock = Date.UTC(2026, 10, 1, 23, 59, 58);
    assert.equal((await ask(pool)).status, 'ok'); assert.equal((await ask(pool)).status, 'ok');
    const blocked = await ask(pool);
    assert.equal(blocked.status, 'limit');
    assert.equal(blocked.resetAt - clock, 2000, 'two seconds before it comes back');
    clock = Date.UTC(2026, 10, 2, 0, 0, 0);
    const again = await ask(pool);
    assert.equal(again.status, 'ok', 'at 00:00 UTC the member has the questions again');
    assert.equal(again.remaining, 1);
    assert.equal(usedOf(pool, ANA, '2026-11-01'), 2); assert.equal(usedOf(pool, ANA, '2026-11-02'), 1);
    // Old rows go away: rows older than 7 days are deleted by a question (no job).
    pool.rows.set(`${ANA}|2026-10-01`, 4);
    pool.rows.set(`${ANA}|2026-10-30`, 4);
    const store = usage.createStore(pool.query);
    await store.consume(BEA, '2026-11-02', 5);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(!pool.rows.has(`${ANA}|2026-10-01`) && pool.rows.has(`${ANA}|2026-10-30`), 'the rows of more than a week ago are deleted');
    const purges = pool.calls.filter((call) => call.sql === usage.SQL.purge).length;
    await store.consume(BEA, '2026-11-02', 5); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pool.calls.filter((call) => call.sql === usage.SQL.purge).length, purges, 'at most once an hour');
  }

  // ---------------------------------------------------------- 5. the cooldown: longer for free members, shorter for Premium
  {
    reset();
    process.env.ASK_COOLDOWN_FREE_SECONDS = '15';
    process.env.ASK_COOLDOWN_PREMIUM_SECONDS = '5';
    const pool = fakePool();
    assert.equal((await ask(pool)).status, 'ok');
    clock += 6_000;
    const wait = await ask(pool);
    assert.equal(wait.status, 'cooldown', 'a free member asks again too soon');
    assert.equal(wait.seconds, 9, 'and is told how many seconds are left');
    assert.equal(usedOf(pool, ANA, askAi.dayOf(clock)), 1, 'a refused question is not counted');
    clock += 9_000;
    assert.equal((await ask(pool)).status, 'ok', 'after 15 seconds it is fine');
    const premium = { who: async () => ({ unlimited: true, team: false, premium: true }) };
    assert.equal((await ask(pool, { userId: BEA }, premium)).status, 'ok');
    clock += 4_000;
    assert.equal((await ask(pool, { userId: BEA }, premium)).status, 'cooldown', 'Premium waits 5 seconds');
    clock += 1_000;
    assert.equal((await ask(pool, { userId: BEA }, premium)).status, 'ok', 'and no more');
    const team = { who: async () => ({ unlimited: true, team: true, premium: false }) };
    assert.equal((await ask(pool, { userId: DEV }, team)).status, 'ok');
    clock += 5_000;
    assert.equal((await ask(pool, { userId: DEV }, team)).status, 'ok', 'the team has the short cooldown too');
  }

  // ---------------------------------------------------------- 6. the caps of the server and of the bot: friendly, and nothing is counted
  {
    reset();
    process.env.ASK_GUILD_PER_HOUR = '2';
    process.env.ASK_GLOBAL_PER_MINUTE = '100';
    const pool = fakePool();
    assert.equal((await ask(pool, { userId: '1' })).status, 'ok'); assert.equal((await ask(pool, { userId: '2' })).status, 'ok');
    const busy = await ask(pool, { userId: '3' });
    assert.equal(busy.status, 'busy', 'a server that met its cap is told I am busy');
    assert.equal(usedOf(pool, '3', askAi.dayOf(clock)), 0, 'and the use is NOT counted');
    assert.equal(modelCalls.length, 2, 'the model was not asked');
    process.env.ASK_COOLDOWN_FREE_SECONDS = '30';
    assert.equal((await ask(pool, { userId: '3' })).status, 'busy', 'the member is not put in cooldown by a refusal (no "wait" instead of "busy")');
    process.env.ASK_COOLDOWN_FREE_SECONDS = '0';
    assert.equal((await ask(pool, { userId: '3', guildId: OTHER_GUILD })).status, 'ok', 'another server is not affected');
    clock += HOUR + 1;
    assert.equal((await ask(pool, { userId: '3' })).status, 'ok', 'an hour later the server can ask again');

    reset();
    process.env.ASK_GLOBAL_PER_MINUTE = '2';
    process.env.ASK_GUILD_PER_HOUR = '100';
    const second = fakePool();
    assert.equal((await ask(second, { userId: '1', guildId: '501' })).status, 'ok'); assert.equal((await ask(second, { userId: '2', guildId: '502' })).status, 'ok');
    assert.equal((await ask(second, { userId: '3', guildId: '503' })).status, 'busy', 'the cap of the whole bot, whatever the server');
    assert.equal(usedOf(second, '3', askAi.dayOf(clock)), 0, 'nothing counted');
    clock += 61_000;
    assert.equal((await ask(second, { userId: '3', guildId: '503' })).status, 'ok', 'a minute later it is fine');
    // A question refused for the daily limit gives its slot of the caps back.
    reset();
    process.env.ASK_FREE_DAILY = '1'; process.env.ASK_GUILD_PER_HOUR = '2';
    const third = fakePool();
    assert.equal((await ask(third)).status, 'ok');
    assert.equal((await ask(third)).status, 'limit'); assert.equal((await ask(third)).status, 'limit');
    assert.equal((await ask(third, { userId: BEA })).status, 'ok', 'refusals did not use the slots of the server');
  }

  // ---------------------------------------------------------- 7. a failed answer gives the use back
  {
    reset();
    process.env.ASK_FREE_DAILY = '2';
    const pool = fakePool();
    const day = askAi.dayOf(clock);
    const failures = [
      [{ ok: false, code: 'timeout' }, 'failed'], [{ ok: false, code: 'upstream' }, 'failed'], [{ ok: false, code: 'empty' }, 'failed'], [{ ok: false, code: 'model' }, 'failed'],
      [{ ok: false, code: 'busy' }, 'busy'], [{ ok: true, content: '   ' }, 'failed'], [{ ok: true, content: '<think>only thoughts</think>' }, 'failed'], [{ ok: true, content: '@everyone' }, 'ok'],
    ];
    for (const [answer, expected] of failures) {
      modelAnswer = answer;
      const before = usedOf(pool, ANA, day);
      const result = await ask(pool);
      assert.equal(result.status, expected, JSON.stringify(answer));
      assert.equal(usedOf(pool, ANA, day), expected === 'ok' ? before + 1 : before, `${JSON.stringify(answer)}: ${expected === 'ok' ? 'an answer is counted' : 'the use is given back'}`);
      if (expected === 'ok') await result.refund();
    }
    assert.equal(usedOf(pool, ANA, day), 0, 'nothing is left counted');
    modelAnswer = { ok: true, content: 'fine' };
    const thrown = await ask(pool, {}, { chat: async () => { throw new Error('boom'); } });
    assert.equal(thrown.status, 'failed', 'a model that throws is a failed answer'); assert.equal(usedOf(pool, ANA, day), 0);
    // The answer was ready but could not be sent: the command gives the use back.
    const ready = await ask(pool);
    assert.equal(usedOf(pool, ANA, day), 1);
    await ready.refund(); await ready.refund();
    assert.equal(usedOf(pool, ANA, day), 0, 'refund() gives it back once');
    // After two failures the member still has both uses.
    modelAnswer = { ok: false, code: 'timeout' };
    await ask(pool); await ask(pool);
    modelAnswer = { ok: true, content: 'a' };
    assert.equal((await ask(pool)).status, 'ok'); assert.equal((await ask(pool)).status, 'ok'); assert.equal((await ask(pool)).status, 'limit');
  }

  // ---------------------------------------------------------- 8. questions at the same time cannot pass the limit; no database means no answer
  {
    reset();
    process.env.ASK_FREE_DAILY = '3';
    const pool = fakePool();
    const results = await Promise.all(Array.from({ length: 12 }, () => ask(pool)));
    assert.equal(results.filter((r) => r.status === 'ok').length, 3, 'twelve at once: exactly 3 answered');
    assert.equal(results.filter((r) => r.status === 'limit').length, 9);
    assert.equal(usedOf(pool, ANA, askAi.dayOf(clock)), 3);
    assert.ok(pool.calls.filter((call) => call.sql === usage.SQL.consume).every((call) => call.sql.includes('where ask_usage.used < $3')), 'every one of them went through the guarded statement');
    // With a cooldown, two questions at once are not both let through either.
    reset();
    process.env.ASK_COOLDOWN_FREE_SECONDS = '15';
    const fresh = fakePool();
    const both = await Promise.all([ask(fresh), ask(fresh)]);
    assert.deepEqual(both.map((r) => r.status).sort(), ['cooldown', 'ok']);
    // The same, from many members at once, with the cap of the server: never more answers than the cap.
    reset();
    process.env.ASK_GUILD_PER_HOUR = '5';
    const crowd = fakePool();
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => ask(crowd, { userId: `700${i}` })));
    assert.equal(many.filter((r) => r.status === 'ok').length, 5, 'a crowd cannot pass the cap of the server');
    // The database fails: the question is refused with a friendly state, nothing is answered, and nothing stays taken.
    reset();
    process.env.ASK_GUILD_PER_HOUR = '1';
    const broken = { ...fakePool().store, consume: async () => { const error = new Error(`connect ECONNREFUSED ${SECRET_QUESTION}`); error.code = 'ECONNREFUSED'; throw error; } };
    const down = await askAi.ask({ userId: ANA, guildId: GUILD, question: SECRET_QUESTION }, deps(fakePool(), { store: broken }));
    assert.equal(down.status, 'db', 'fail closed: no free answers when the count cannot be made');
    assert.equal(modelCalls.length, 0, 'the model was not asked');
    assert.equal((await ask(fakePool())).status, 'ok', 'and the slot of the cap was given back');
    // Premium and the team do not need the database (nothing to count).
    process.env.ASK_GUILD_PER_HOUR = '100';
    const premiumDown = await askAi.ask({ userId: BEA, guildId: GUILD, question: 'hi' }, deps(fakePool(), { store: broken, who: async () => ({ unlimited: true, premium: true }) }));
    assert.equal(premiumDown.status, 'ok', 'Premium has nothing to count, so a database that is down does not stop it');
  }

  // ---------------------------------------------------------- 9. off, and not configured
  {
    reset();
    const pool = fakePool();
    process.env.ASK_ENABLED = 'false';
    assert.equal((await ask(pool)).status, 'disabled', 'ASK_ENABLED=false switches it off without a deploy');
    for (const value of ['0', 'off', 'FALSE']) { process.env.ASK_ENABLED = value; assert.equal(askAi.isEnabled(), false, value); }
    for (const value of ['true', '1', '']) { process.env.ASK_ENABLED = value; assert.equal(askAi.isEnabled(), true, `"${value}" leaves it on`); }
    delete process.env.ASK_ENABLED;
    process.env.GROQ_API_KEY = '   ';
    assert.equal((await ask(pool)).status, 'not_configured', 'no key: not available');
    assert.equal(pool.calls.length, 0, 'and no use is consumed');
    assert.equal(modelCalls.length, 0);
    process.env.GROQ_API_KEY = 'check-only-key';
    const usageNow = await askAi.remainingToday(ANA, deps(pool));
    assert.deepEqual([usageNow.unlimited, usageNow.left, usageNow.limit], [false, 10, 10], 'the count of the day is read with no key');
  }

  // ---------------------------------------------------------- 10. what the model writes is made safe
  {
    const clean = (text, options) => askAi.sanitizeAnswer(text, options);
    assert.equal(clean('hello @everyone and @here, and @EVERYONE'), 'hello @\u200Beveryone and @\u200Bhere, and @\u200BEVERYONE', '@everyone and @here cannot ping');
    assert.ok(!/@everyone|@here/i.test(clean('x @everyone @here')), 'no literal ping is left');
    assert.equal(clean('hi <@123456789012345678>, <@!123456789012345678> and <@&987654321098765432> in <#555555555555555555>'), 'hi @user, @user and @role in #channel', 'user, role and channel mentions are plain words');
    assert.equal(clean('join https://discord.gg/abc123 or discord.gg/xyz or https://discord.com/invite/Q-w_e or discordapp.com/invite/zzz now'), 'join  or  or  or  now', 'invite links are removed');
    assert.ok(!/discord\.gg|\/invite\//i.test(clean('see discord.gg/abc and https://discord.com/invite/abc')), 'no invite stays');
    assert.equal(clean('keep https://petto.sbs and https://wiki.petto.sbs'), 'keep https://petto.sbs and https://wiki.petto.sbs', 'other links stay');
    assert.equal(clean('<think>secret thinking</think>The answer.'), 'The answer.', 'thinking tags are dropped');
    assert.equal(clean(''), '…', 'never empty'); assert.equal(clean(null), '…'); assert.equal(clean('   \n  '), '…'); assert.equal(clean('<think>x</think>', { fallback: 'Sorry.' }), 'Sorry.');
    assert.equal(clean('a\n\n\n\n\nb'), 'a\n\nb', 'blank lines are not stacked');
    const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const cut = clean(long);
    assert.ok(cut.length <= 1900, `clipped to 1900 (${cut.length})`);
    assert.match(cut, /\.…$/, 'cut at the end of a sentence, with an ellipsis');
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} of the answer`).join('\n');
    assert.match(clean(lines), /line \d+ of the answer…$/, 'or at the end of a line');
    assert.ok(clean(lines).length <= 1900);
    assert.ok(clean('x'.repeat(5000)).length <= 1900 && clean('x'.repeat(5000)).length > 1850, 'a text with no break is cut anyway');
    const code = `${'intro text. '.repeat(10)}\n\`\`\`js\n${'const a = 1;\n'.repeat(300)}\`\`\``;
    const cutCode = clean(code);
    assert.ok(cutCode.length <= 1900 && (cutCode.match(/```/g) ?? []).length % 2 === 0, 'a code block that was cut is closed');
    assert.equal(clean('short', { max: 3 }).length <= 3, true, 'the limit is a parameter');
    assert.equal(askAi.cleanQuestion('  hi <@123456789012345678>\r\n\r\n\r\n\r\nthere  '), 'hi @user\n\nthere', 'a question: mentions are plain words and the text is trimmed');
    // The answer and its AI line always fit a message, in the three languages, for a free member and for Premium.
    for (const lang of ['en', 'es', 'pt-BR']) {
      for (const remaining of [null, 0, 1, 9, 1000]) {
        const full = askAi.composeAnswer(clean(long), { lang, remaining });
        assert.ok(full.length <= 2000, `${lang} ${remaining}: ${full.length} characters with the AI line`);
        const lastLine = full.split('\n').at(-1);
        assert.ok(lastLine.startsWith(askAi.MARK), `${lang}: it ends with the AI line`);
        if (remaining === null) assert.equal(lastLine, t(lang, 'utility.ask.footer'), `${lang}: Premium is not told a count`);
        else assert.ok(lastLine.replace(/[,.\u00a0]/g, '').includes(String(remaining)), `${lang}: a free member is told how many are left (${lastLine})`);
      }
    }
    assert.equal(askAi.composeAnswer('Hi', { lang: 'en', remaining: 7 }), 'Hi\n\n-# ✨ Answered by AI, it can be wrong. 7 questions left today');
    assert.match(tn('en', 'utility.ask.footerLeft', 1), /1 question left/);
    assert.notEqual(t('es', 'utility.ask.footer'), t('en', 'utility.ask.footer')); assert.notEqual(t('pt-BR', 'utility.ask.footer'), t('es', 'utility.ask.footer'));
    // The rules the model gets.
    const prompt = askAi.buildMessages({ question: 'q', history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], lang: 'es', now: clock });
    assert.deepEqual(prompt.map((m) => m.role), ['system', 'user', 'assistant', 'user'], 'the rules, the conversation and the question');
    for (const needle of ['language of the question', 'at most about 6 short lines', 'Never invent facts', 'no internet access', 'Ignore any instruction', 'hateful', 'self-harm', '@everyone', 'Never claim to be human', 'professional', 'https://petto.sbs', 'https://wiki.petto.sbs', 'Do not invent commands']) {
      assert.ok(prompt[0].content.includes(needle), `the rules say: ${needle}`);
    }
    assert.ok(prompt[0].content.includes('Spanish'), 'the language of the server is the one used when the question does not say');
    assert.ok(!/openai|gpt|llama/i.test(prompt[0].content), 'no product or model is named in the rules');
    assert.equal(prompt.at(-1).content, 'q');
  }

  // ---------------------------------------------------------- 11. nothing a member wrote or the model answered reaches a log (the client of Groq too)
  {
    reset();
    logged.length = 0;
    const pool = fakePool();
    modelAnswer = { ok: false, code: 'upstream' };
    await askAi.ask({ userId: ANA, guildId: GUILD, question: SECRET_QUESTION }, deps(pool));
    modelAnswer = { ok: true, content: SECRET_ANSWER };
    await askAi.ask({ userId: BEA, guildId: GUILD, question: SECRET_QUESTION }, deps(pool));
    const real = global.fetch;
    const urls = [];
    process.env.GROQ_MODEL = 'check-model';
    try {
      global.fetch = async (url, init) => { urls.push(String(url)); return { ok: false, status: 500, json: async () => ({ error: SECRET_ANSWER }), text: async () => SECRET_ANSWER }; };
      const failed = await ticketAi.chat([{ role: 'user', content: SECRET_QUESTION }], 50, 'ask');
      assert.deepEqual(failed, { ok: false, code: 'upstream' });
      global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
      assert.deepEqual(await ticketAi.chat([{ role: 'user', content: SECRET_QUESTION }], 50, 'ask'), { ok: false, code: 'busy' });
      global.fetch = async () => { const error = new Error(`network ${SECRET_QUESTION}`); error.name = 'TimeoutError'; throw error; };
      assert.deepEqual(await ticketAi.chat([{ role: 'user', content: SECRET_QUESTION }], 50, 'ask'), { ok: false, code: 'timeout' });
      logged.push('--- tickets'); // the tickets keep their own tag
      global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
      await ticketAi.chat([{ role: 'user', content: 'hello' }]);
      global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'fine' } }] }) });
      assert.deepEqual(await ticketAi.chat([{ role: 'user', content: 'x' }], 10, 'ask'), { ok: true, content: 'fine' });
    } finally { global.fetch = real; delete process.env.GROQ_MODEL; }
    const all = logged.join('\n');
    assert.ok(!all.includes('SECRETQUESTION') && !all.includes('SECRETANSWER'), `no question or answer in the logs:\n${all}`);
    assert.match(all, /\[ask\] Groq answered 500/, 'the log of the AI says what status it got, with the tag of the feature');
    assert.match(all.split('--- tickets')[1], /\[ticket-ai\] Groq answered 500/, 'the ticket assistant keeps its tag');
  }

  // ---------------------------------------------------------- 12. the reply chain: context, who continues, and what does not
  {
    reset();
    const channel = { id: ROOM, messages: { cache: new Map(), fetch: async (id) => { const found = channel.messages.cache.get(id); if (!found) throw new Error('Unknown Message'); return found; } } };
    let seq = 100;
    const bot = { id: BOT, bot: true };
    const member = (id) => ({ id, bot: false });
    const send = (author, content, replyTo = null) => {
      seq += 1;
      const message = { id: String(seq), author, content, channel, guild: { id: GUILD }, client: { user: { id: BOT } }, reference: replyTo ? { messageId: replyTo.id } : null, mentions: { repliedUser: replyTo && !replyTo.author.bot ? null : replyTo?.author ?? null } };
      channel.messages.cache.set(message.id, message);
      return message;
    };
    const answer = (to, text) => send(bot, `${text}\n\n${t('en', 'utility.ask.footerLeft.other', { count: 5 })}`, to);
    const q1 = send(member(ANA), '!ask what is the capital of France?');
    const a1 = answer(q1, 'Paris.');
    const q2 = send(member(ANA), 'and of Spain?', a1);
    const a2 = answer(q2, 'Madrid.');
    const q3 = send(member(ANA), 'petto ask and Italy?', a2);
    const a3 = answer(q3, 'Rome.');
    const q4 = send(member(ANA), 'and Portugal?', a3);
    const history = await askAi.historyFor(q4);
    assert.deepEqual(history.map((turn) => turn.role), ['user', 'assistant', 'user', 'assistant'], 'at most 4 messages back, as alternating turns, starting with the member');
    assert.deepEqual(history.map((turn) => turn.content), ['and of Spain?', 'Madrid.', 'and Italy?', 'Rome.'], 'the oldest of the 5 earlier messages is out, the command word and the AI line are stripped');
    const short = await askAi.historyFor(q2);
    assert.deepEqual(short.map((turn) => `${turn.role}:${turn.content}`), ['user:what is the capital of France?', 'assistant:Paris.'], '`!ask ` is not part of the question');
    assert.equal(askAi.MAX_BACK, 4);
    assert.deepEqual(await askAi.historyFor(send(member(ANA), '!ask hello')), [], 'no reply, no context');
    assert.deepEqual(await askAi.stripCommand('<@123> ask who?'), 'who?'); assert.equal(askAi.stripCommand('!ai ask who?'), 'who?'); assert.equal(askAi.stripCommand('p! ask who?'), 'who?'); assert.equal(askAi.stripCommand('task force 141?'), 'task force 141?');
    // Somebody else's message in the chain ends it; an answer to somebody else's question still gives its text.
    const bq = send(member(BEA), '!ask what is 2+2?');
    const ba = answer(bq, 'Four.');
    const ana = send(member(ANA), '!ask explain it more', ba);
    const mixed = await askAi.historyFor(ana);
    assert.deepEqual(mixed.map((turn) => turn.role), ['user', 'assistant'], 'the answer is context, the question of somebody else is not');
    assert.equal(mixed[1].content, 'Four.');
    const long = answer(q1, 'x'.repeat(5000));
    assert.ok((await askAi.historyFor(send(member(ANA), 'more?', long))).at(-1).content.length <= 900, 'each turn is clipped');
    const other = send(bot, 'a card of another command', q1);
    assert.deepEqual(await askAi.historyFor(send(member(ANA), 'more?', other)), [], 'a message of the bot that is not an AI answer ends the chain');
    // A message that was deleted ends it too.
    const orphan = send(member(ANA), 'and the rest?', send(bot, `Old.\n\n${askAi.MARK}Answered`, { id: 'gone', author: member(ANA) }));
    assert.deepEqual((await askAi.historyFor(orphan)).map((turn) => turn.role), ['user', 'assistant']);

    // who continues
    const guildOf = { id: GUILD };
    assert.equal(await askAi.isFollowUp(q4), true, 'the member who asked, replying to the answer, continues');
    assert.equal(await askAi.isFollowUp({ ...send(member(BEA), 'and Portugal?', a3), guild: guildOf }), false, 'somebody else replying to that answer does not');
    assert.equal(await askAi.isFollowUp(send(member(ANA), 'thanks', q3)), false, 'a reply to the member\'s own question is plain chat');
    assert.equal(await askAi.isFollowUp(send(member(ANA), 'thanks', other)), false, 'a reply to another message of the bot is not');
    assert.equal(await askAi.isFollowUp(send(member(ANA), 'hello')), false, 'a message that is not a reply costs nothing');
    assert.equal(await askAi.isFollowUp(send(member(ANA), '   ', a3)), false, 'nothing written, nothing to ask');
    const strangerAnswer = send(bot, `Hi.\n\n${askAi.MARK}Answered by AI`, null);
    assert.equal(await askAi.isFollowUp(send(member(ANA), 'and?', strangerAnswer)), false, 'an answer that is not a reply to a member (a slash answer) cannot be verified: no');
    process.env.ASK_ENABLED = 'false';
    assert.equal(await askAi.isFollowUp(send(member(ANA), 'and Portugal?', a3)), false, 'switched off: plain chat');
    delete process.env.ASK_ENABLED;
    process.env.GROQ_API_KEY = '';
    assert.equal(await askAi.isFollowUp(send(member(ANA), 'and Portugal?', a3)), false, 'not configured: plain chat');
    process.env.GROQ_API_KEY = 'check-only-key';
    // After a restart the answer is not in the cache: it is only looked for when the reply was meant for the bot (a plain reply mentions its author), or it was remembered.
    const fetched = [];
    const real = channel.messages.fetch;
    const uncached = send(member(ANA), 'and Portugal?', a3);
    channel.messages.cache.delete(a3.id); channel.messages.cache.delete(q3.id); uncached.mentions.repliedUser = null;
    channel.messages.fetch = async (id) => { fetched.push(id); return id === a3.id ? a3 : real(id); };
    assert.equal(await askAi.isFollowUp(uncached), false, 'not in the cache and not for the bot: no search');
    assert.deepEqual(fetched, [], 'with no request to Discord');
    uncached.mentions.repliedUser = bot;
    assert.equal(await askAi.isFollowUp(uncached), false, 'looked for, but the question of the answer is not in the cache either and is looked for: not found, so no');
    channel.messages.cache.set(q3.id, q3);
    assert.equal(await askAi.isFollowUp(uncached), true, 'a reply meant for the bot is checked with one fetch of the answer');
    askAi.rememberAnswer(a3.id, ANA);
    uncached.mentions.repliedUser = null;
    assert.equal(await askAi.isFollowUp(uncached), true, 'an answer the bot remembers sending is known without asking who wrote the question');
    assert.equal(await askAi.isFollowUp({ ...uncached, author: member(BEA) }), false, 'and still only for the member who asked');
    channel.messages.fetch = real;
  }

  // ---------------------------------------------------------- 13. the real pipelines: prefix forms, rules, the follow-up, not configured
  const { loadCommands, collectCommandData } = require('../src/handlers/commandHandler');
  patch('src/db/guilds.js', { ensureGuild: async () => ({ prefix: '!', prefixes: ['!', 'petto'], language: 'en' }), getGuild: async () => ({ prefix: '!', prefixes: ['!', 'petto'], language: 'en' }) });
  let customRow = null;
  let disabledNames = new Set();
  let restrictedNames = new Set();
  let blockedLevels = new Set();
  patch('src/db/commandAliases.js', { get: async () => null });
  patch('src/db/customCommands.js', { getCommand: async (guildId, name) => (customRow && name === customRow.name ? customRow : null) });
  patch('src/db/disabledCommands.js', { findCached: async (guildId, name, channelId) => (disabledNames.has(name) ? { channel_id: channelId === ROOM && disabledNames.channel ? ROOM : null } : null), canonicalizeStored: async () => 0 });
  patch('src/db/commandRestrictions.js', { restrictionMap: async () => Object.fromEntries([...restrictedNames].map((name) => [name, ['900000000000000009']])) });
  patch('src/db/permissions.js', { hasCommandPermission: async (guildId, name) => !blockedLevels.has(name), listGroups: async () => [] });
  patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
  patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
  patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
  patch('src/logging/extraLog.js', { logCommandUse() {} });
  patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
  patch('src/utils/moderationPermissions.js', { hasConfiguredRole: async () => false });

  const pool = fakePool();
  patch('src/db/askUsage.js', { consume: pool.store.consume, refund: pool.store.refund, usedOn: pool.store.usedOn });
  const premiumUsers = new Set();
  patch('src/db/premium.js', { getUserPremium: async (id) => ({ active: premiumUsers.has(id) }) });
  let chatCalls = [];
  ticketAi.chat = async (messages, max, tag) => { chatCalls.push({ messages, max, tag }); return { ok: true, content: modelAnswer.content ?? 'Paris.' }; };

  const client = { user: { id: BOT, bot: true, displayAvatarURL: () => 'https://example.com/a.png' }, guilds: { cache: new Collection() }, channels: { cache: new Collection(), fetch: async () => null }, users: { cache: new Collection(), fetch: async () => null }, ws: { ping: 1 }, shard: null };
  loadCommands(client);
  const event = require('../src/events/messageCreateCommands');
  const interactionCreate = require('../src/events/interactionCreate');
  const aiCommand = client.commands.get('ai');
  assert.ok(aiCommand, '/ai is loaded');

  const chan = { id: ROOM, type: 0, messages: { cache: new Map(), fetch: async (id) => { const found = chan.messages.cache.get(id); if (!found) throw new Error('Unknown Message'); return found; } }, typing: 0 };
  chan.sendTyping = async () => { chan.typing += 1; };
  chan.send = async (payload) => { chan.sentLoose.push(payload); return { id: 'loose' }; };
  chan.sentLoose = [];
  const guild = { id: GUILD, name: 'Petto Test', ownerId: '1', members: { cache: new Collection(), fetch: async () => new Collection() }, channels: { cache: new Collection() }, roles: { cache: new Collection() } };
  let seq = 1000;
  const sentBy = new Map(); // message id -> what the bot replied
  /** A message typed by a member (`replyTo`: a message it replies to). `{ message, replies }`: what the bot replied to it. */
  function makeMessage(content, { as = ANA, replyTo = null, perms = 0n } = {}) {
    seq += 1;
    const replies = [];
    const message = {
      id: String(seq), content, author: { id: as, bot: false, toString: () => `<@${as}>` }, guild, guildId: GUILD, client, channel: chan, channelId: ROOM,
      member: { id: as, guild: { ownerId: '1' }, permissions: new PermissionsBitField(perms), roles: { cache: new Collection(), highest: { position: 1 } } },
      mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map(), repliedUser: replyTo ? replyTo.author : null }, attachments: new Map(),
      reference: replyTo ? { messageId: replyTo.id } : null, replies,
      reply: async (payload) => {
        seq += 1;
        const sent = { id: String(seq), author: { id: BOT, bot: true }, content: payload.content ?? '', payload, reference: { messageId: message.id }, channel: chan, edit: async () => sent };
        chan.messages.cache.set(sent.id, sent);
        replies.push(sent);
        return sent;
      },
    };
    chan.messages.cache.set(message.id, message);
    return message;
  }
  const flat = (payload) => JSON.stringify(payload ?? {});
  async function typed(content, options = {}) {
    chatCalls = [];
    const message = makeMessage(content, options);
    await event.execute(message);
    return { message, replies: message.replies, chat: chatCalls, said: message.replies.map((reply) => flat(reply.payload)).join(' / ') };
  }
  const day = () => new Date().toISOString().slice(0, 10);
  const usedToday = (user) => pool.rows.get(`${user}|${day()}`) ?? 0;
  const resetAll = () => { reset(); pool.rows.clear(); premiumUsers.clear(); disabledNames = new Set(); restrictedNames = new Set(); blockedLevels = new Set(); customRow = null; chatCalls = []; modelAnswer = { ok: true, content: 'Paris.' }; chan.messages.cache.clear(); chan.typing = 0; };
  clock = Date.now();

  // the prefix forms
  {
    resetAll();
    for (const text of ['!ask what is the capital of France?', 'petto ask what is the capital of France?', 'PETTO Ask what is the capital of France?', `<@${BOT}> ask what is the capital of France?`, '!ai ask what is the capital of France?', 'petto ask me anything']) {
      askAi.resetState();
      const result = await typed(text);
      assert.equal(result.chat.length, 1, `\`${text}\` asks the model (${result.said})`);
      assert.equal(result.replies.length, 1, `\`${text}\` is answered once`);
      const payload = result.replies[0].payload;
      assert.match(payload.content, /^Paris\./, 'the answer is a plain text message');
      assert.ok(payload.content.endsWith(t('en', 'utility.ask.footerLeft.other', { count: 9 })) || payload.content.endsWith(t('en', 'utility.ask.footerLeft.other', { count: askAi.limits().freeDaily - usedToday(ANA) })), `with its AI line: ${payload.content}`);
      assert.deepEqual(payload.allowedMentions.parse, [], 'it pings nobody');
      assert.equal(payload.allowedMentions.repliedUser, false);
      assert.ok(!payload.flags && !payload.components, 'text only');
      assert.equal(result.replies[0].reference.messageId, result.message.id, 'as a reply to the message');
      assert.equal(result.chat[0].tag, 'ask', 'through the client of Groq with the tag of the feature');
    }
    assert.ok(chan.typing >= 6, 'the bot shows that it is typing while it thinks');
    // the question reaches the model whole (line breaks and quotes kept), and only what follows the command word
    askAi.resetState();
    let result = await typed('!ask what is "x"?\nand "y"?');
    assert.equal(result.chat[0].messages.at(-1).content, 'what is "x"?\nand "y"?');
    askAi.resetState();
    result = await typed('!ASK   spaced   out  ');
    assert.equal(result.chat[0].messages.at(-1).content, 'spaced   out');
    // no question
    askAi.resetState();
    result = await typed('!ask');
    assert.equal(result.chat.length, 0, 'no question, no model'); assert.equal(result.replies.length, 1, 'it says how to write it');
    // !ai alone lists, !ai usage and !askusage tell the count
    result = await typed('!ai');
    assert.equal(result.chat.length, 0); assert.equal(result.replies.length, 1); assert.match(result.said, /ask/); assert.match(result.said, /usage/);
    askAi.resetState();
    const before = usedToday(ANA);
    for (const text of ['!ai usage', '!askusage', 'petto askusage', '!ai left']) {
      result = await typed(text);
      assert.equal(result.chat.length, 0); assert.equal(result.replies.length, 1, text);
      assert.match(result.said, new RegExp(`\\*\\*${askAi.limits().freeDaily - before}\\*\\* questions left today \\(of ${askAi.limits().freeDaily}\\)`), `${text}: how many are left`);
      assert.match(result.said, /<t:\d+:R>/, 'and when they come back');
    }
    assert.equal(usedToday(ANA), before, 'looking at the count does not count');
    premiumUsers.add(ANA); askAi.resetState();
    result = await typed('!ai usage');
    assert.equal(result.replies[0].payload.content, t('en', 'utility.ask.usage.unlimited'), 'Premium: unlimited');
    askAi.resetState();
    result = await typed('!ask a question for Premium');
    assert.ok(!result.replies[0].payload.content.includes('left today'), 'and no count in the answer');
    premiumUsers.clear();
  }

  // everyday words, and a word the server uses for something else
  {
    resetAll();
    assert.ok(isCommonWord('ai') && !isCommonWord('ask'), '`ai` is an everyday word (like `me` and `bot`) and `ask` must work after a word prefix');
    let result = await typed('petto ai is cool');
    assert.equal(result.chat.length, 0); assert.equal(result.replies.length, 0, '`petto ai is cool` is chat');
    result = await typed('petto ai ask me');
    assert.equal(result.chat.length, 0, '`ai` after a word prefix is chat, `petto ask` is the command');
    result = await typed('!ai ask me anything');
    assert.equal(result.chat.length, 1, '`!ai ask` works with a symbol prefix');
    askAi.resetState();
    customRow = { name: 'ask', response: 'our FAQ is here', trigger_type: 'command' };
    result = await typed('!ask how do I join?');
    assert.equal(result.chat.length, 0, 'a server that already has a custom command `ask` keeps it');
    assert.match(result.said, /our FAQ/);
    customRow = null; askAi.resetState();
    const earlier = await typed('!ask first');
    customRow = { name: 'ask', response: 'faq', trigger_type: 'command' };
    const followed = makeMessage('and then?', { replyTo: earlier.replies[0] });
    chatCalls = []; await event.execute(followed);
    assert.equal(chatCalls.length, 0, 'and the follow-up does not run either');
    customRow = null;
  }

  // the follow-up
  {
    resetAll();
    const first = await typed('!ask what is the capital of France?');
    const answer = first.replies[0];
    const before = usedToday(ANA);
    askAi.resetState();
    modelAnswer = { ok: true, content: 'Madrid.' };
    let result = await typed('and of Spain?', { replyTo: answer });
    assert.equal(result.chat.length, 1, 'a plain reply of the member to the answer is a question');
    assert.deepEqual(result.chat[0].messages.slice(1).map((m) => `${m.role}:${m.content}`), ['user:what is the capital of France?', 'assistant:Paris.', 'user:and of Spain?'], 'with the conversation before it');
    assert.match(result.replies[0].payload.content, /^Madrid\./);
    assert.equal(result.replies[0].reference.messageId, result.message.id, 'as a reply to the new message');
    assert.equal(usedToday(ANA), before + 1, 'it counts as one use, like any question');
    assert.deepEqual(result.replies[0].payload.allowedMentions.parse, []);
    // and the next one goes on from the new answer
    askAi.resetState();
    result = await typed('and Italy?', { replyTo: result.replies[0] });
    assert.deepEqual(result.chat[0].messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
    assert.equal(askAi.MAX_BACK, 4);
    // somebody else does not continue it, and a reply to anything else is chat
    askAi.resetState();
    result = await typed('and of Spain?', { replyTo: answer, as: BEA });
    assert.equal(result.chat.length, 0); assert.equal(result.replies.length, 0, 'another member replying: nothing');
    result = await typed('thanks!', { replyTo: first.message });
    assert.equal(result.replies.length, 0, 'a reply to the question: nothing');
    result = await typed('hello', {});
    assert.equal(result.replies.length, 0, 'a message that is not a reply: nothing');
    // a reply with the command word is a question for anybody, with the answer as context
    askAi.resetState();
    result = await typed('!ask and of Spain?', { replyTo: answer, as: BEA });
    assert.equal(result.chat.length, 1, 'with the command, anybody can ask');
    assert.deepEqual(result.chat[0].messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user'], "somebody else's answer is context, their question is not");
    // the limit stops a follow-up the way it stops a question, and says so
    resetAll();
    process.env.ASK_FREE_DAILY = '2';
    const one = await typed('!ask one'); askAi.resetState();
    await typed('two', { replyTo: one.replies[0] }); askAi.resetState();
    result = await typed('three', { replyTo: one.replies[0] });
    assert.equal(result.chat.length, 0); assert.match(result.said, /\*\*2\*\* questions of today/, 'the follow-up that passes the limit is told, with when they come back');
    assert.match(result.said, /<t:\d+:R>/);
    assert.equal(usedToday(ANA), 2);
  }

  // the rules of a server: prefix, follow-up
  {
    resetAll();
    const first = await typed('!ask hello');
    const answer = first.replies[0];
    const attempt = async (label, { prefixNotice }) => {
      askAi.resetState();
      const used = usedToday(ANA);
      let result = await typed('!ask hello again');
      assert.equal(result.chat.length, 0, `${label}: !ask does not ask the model`);
      assert.equal(result.replies.length, 1, `${label}: the member is told`);
      assert.match(result.said, prefixNotice, `${label}: ${result.said}`);
      askAi.resetState();
      result = await typed('!ai ask hello again');
      assert.equal(result.chat.length, 0, `${label}: !ai ask neither`);
      askAi.resetState();
      result = await typed('petto ask hello again');
      assert.equal(result.chat.length, 0, `${label}: nor petto ask`);
      askAi.resetState();
      result = await typed('and then?', { replyTo: answer });
      assert.equal(result.chat.length, 0, `${label}: the follow-up does not ask the model`);
      assert.equal(result.replies.length, 0, `${label}: and it is plain chat, with no notice`);
      assert.equal(usedToday(ANA), used, `${label}: nothing was counted`);
      result = await typed('!ai usage');
      return result;
    };
    disabledNames = new Set(['ask']);
    let usageResult = await attempt('!disablecommand ask', { prefixNotice: /turned off|disabled/i });
    assert.equal(usageResult.replies.length, 1, 'the count is a different command: it still answers');
    assert.match(usageResult.said, /questions left today/);
    disabledNames = new Set(['ai']);
    usageResult = await attempt('!disablecommand ai (the umbrella)', { prefixNotice: /turned off|disabled/i });
    assert.equal(usageResult.chat.length, 0); assert.match(usageResult.said, /turned off|disabled/i, 'the umbrella turns off the count too');
    disabledNames = new Set(['askusage']);
    askAi.resetState();
    assert.match((await typed('!ai usage')).said, /turned off|disabled/i, '`askusage` turns off the count');
    assert.equal((await typed('!ask works fine')).chat.length, 1, 'and not the questions');
    disabledNames = new Set(['ask']); disabledNames.channel = true;
    await attempt('!disablecommand ask in this channel', { prefixNotice: /turned off|disabled/i });
    disabledNames = new Set();
    restrictedNames = new Set(['ask']);
    await attempt('!restrictcommand ask', { prefixNotice: /Only members with/i });
    restrictedNames = new Set();
    blockedLevels = new Set(['ask']);
    await attempt('a permission level for ask', { prefixNotice: /permission level/i });
    blockedLevels = new Set();
    askAi.resetState();
    assert.equal((await typed('and then?', { replyTo: answer })).chat.length, 1, 'with the rules gone it works again');
  }

  // not configured, and switched off
  {
    resetAll();
    pool.calls.length = 0;
    process.env.GROQ_API_KEY = '';
    let result = await typed('!ask hello');
    assert.equal(result.chat.length, 0); assert.equal(result.replies.length, 1);
    assert.equal(result.replies[0].payload.content, t('en', 'utility.ask.unavailable'), 'no key: it says it is not available right now');
    assert.equal(pool.calls.length, 0, 'and no use was consumed (the database was not even touched)');
    result = await typed('!ai usage');
    assert.match(result.said, /questions left today/, '!ai usage still works');
    assert.equal((await typed('and then?', { replyTo: makeMessage('x') })).replies.length, 0, 'a reply is chat');
    process.env.GROQ_API_KEY = 'check-only-key';
    process.env.ASK_ENABLED = 'false';
    result = await typed('!ask hello');
    assert.equal(result.chat.length, 0); assert.equal(result.replies[0].payload.content, t('en', 'utility.ask.off'));
    assert.equal(pool.calls.filter((call) => call.sql === usage.SQL.consume).length, 0);
    assert.match((await typed('!ai usage')).said, /questions left today/, '!ai usage works when it is off');
    delete process.env.ASK_ENABLED;
    // a failed answer says nothing was counted, and the use is back
    resetAll();
    modelAnswer = null;
    ticketAi.chat = async (messages, max, tag) => { chatCalls.push({ messages, max, tag }); return { ok: false, code: 'timeout' }; };
    result = await typed('!ask hello');
    assert.equal(result.replies[0].payload.content, t('en', 'utility.ask.failed')); assert.equal(usedToday(ANA), 0, 'a failed answer is not counted');
    ticketAi.chat = async (messages, max, tag) => { chatCalls.push({ messages, max, tag }); return { ok: false, code: 'busy' }; };
    askAi.resetState();
    result = await typed('!ask hello');
    assert.equal(result.replies[0].payload.content, t('en', 'utility.ask.busy')); assert.equal(usedToday(ANA), 0);
    // the cooldown is told with the seconds
    ticketAi.chat = async (messages, max, tag) => { chatCalls.push({ messages, max, tag }); return { ok: true, content: 'Hi' }; };
    resetAll();
    delete process.env.ASK_COOLDOWN_FREE_SECONDS;
    await typed('!ask one');
    result = await typed('!ask two');
    assert.equal(result.chat.length, 0); assert.match(result.said, /Wait \*\*1[0-5]s\*\*/, 'a second question too soon is told to wait');
    // the database fails: refused, friendly
    resetAll();
    patch('src/db/askUsage.js', { consume: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); }, usedOn: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); } });
    result = await typed('!ask hello');
    assert.equal(result.chat.length, 0); assert.equal(result.replies[0].payload.content, t('en', 'utility.ask.db'), 'no database: no answer, said kindly');
    assert.equal((await typed('!ai usage')).replies[0].payload.content, t('en', 'utility.ask.db'));
    patch('src/db/askUsage.js', { consume: pool.store.consume, refund: pool.store.refund, usedOn: pool.store.usedOn });
  }

  // ---------------------------------------------------------- 14. the slash command: public answer, private refusals, the same rules
  {
    resetAll();
    ticketAi.chat = async (messages, max, tag) => { chatCalls.push({ messages, max, tag }); return { ok: true, content: 'Slash answer. @everyone' }; };
    const slash = async (sub, values = { question: 'what is a cat?' }, { as = ANA } = {}) => {
      const calls = [];
      const member = { id: as, guild, permissions: new PermissionsBitField(0n), roles: { cache: new Collection() } };
      const base = {
        id: '777', commandName: 'ai', commandType: 1, user: { id: as, bot: false }, member, guild, guildId: GUILD, channel: chan, channelId: ROOM, locale: 'en-US', guildLocale: 'en-US', pettoLang: 'en', typedPrefix: '/', client,
        deferred: false, replied: false,
        options: { getSubcommand: () => sub, getSubcommandGroup: () => null, getString: (name, required) => { const value = values[name] ?? null; if (value === null && required) throw new Error('missing'); return value; } },
        isChatInputCommand: () => true, isRepliable: () => true,
        reply: async (payload) => { calls.push(['reply', payload]); base.replied = true; return { id: 'r' }; },
        deferReply: async (payload) => { calls.push(['defer', payload ?? {}]); base.deferred = true; },
        editReply: async (payload) => { calls.push(['edit', payload]); return { id: 'e' }; },
        deleteReply: async () => { calls.push(['delete']); },
        followUp: async (payload) => { calls.push(['followUp', payload]); return { id: 'f' }; },
      };
      const interaction = new Proxy(base, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
      chatCalls = [];
      await interactionCreate.execute(interaction, client);
      return { calls, chat: chatCalls };
    };
    const ephemeral = (payload) => (payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
    let result = await slash('ask');
    assert.deepEqual(result.calls.map((call) => call[0]), ['defer', 'edit'], 'it thinks (deferred) and then answers');
    assert.ok(!result.calls[0][1].flags && !ephemeral(result.calls[0][1]), 'the thinking message is public');
    assert.ok(!result.calls[1][1].flags, 'and so is the answer');
    assert.ok(result.calls[1][1].content.startsWith('Slash answer. @\u200Beveryone'), 'cleaned: @everyone is defused');
    assert.deepEqual(result.calls[1][1].allowedMentions.parse, [], 'it pings nobody');
    assert.match(result.calls[1][1].content, /questions left today$/);
    assert.equal(usedToday(ANA), 1);
    result = await slash('usage');
    assert.equal(result.calls.length, 1); assert.ok(ephemeral(result.calls[0][1]), 'the count is private'); assert.match(result.calls[0][1].content, /\*\*9\*\* questions left today \(of 10\)/);
    // a refusal after the thinking message: the public one goes, the refusal is private
    resetAll(); askAi.resetState(); process.env.ASK_FREE_DAILY = '1';
    await slash('ask'); askAi.resetState();
    result = await slash('ask');
    assert.deepEqual(result.calls.map((call) => call[0]), ['defer', 'delete', 'followUp'], 'the thinking message is removed and the refusal is a private follow-up');
    assert.ok(ephemeral(result.calls[2][1]) && /<t:\d+:R>/.test(result.calls[2][1].content), 'private, with when it comes back');
    assert.equal(result.chat.length, 0);
    // before thinking: off and not configured are private at once
    resetAll();
    process.env.GROQ_API_KEY = '';
    result = await slash('ask');
    assert.deepEqual(result.calls.map((call) => call[0]), ['reply']); assert.ok(ephemeral(result.calls[0][1])); assert.equal(result.calls[0][1].content, t('en', 'utility.ask.unavailable'));
    process.env.GROQ_API_KEY = 'check-only-key';
    result = await slash('ask', { question: '   ' });
    assert.ok(ephemeral(result.calls[0][1]) && result.chat.length === 0, 'an empty question is told in private');
    result = await slash('ask', { question: 'x'.repeat(801) });
    assert.equal(result.calls[0][1].content, t('en', 'utility.ask.tooLong', { max: 800 }), 'a question over 800 characters is told');
    // the rules of the server stop it
    resetAll(); askAi.resetState();
    disabledNames = new Set(['ask']);
    result = await slash('ask'); assert.equal(result.chat.length, 0, '!disablecommand ask stops /ai ask'); assert.ok(ephemeral(result.calls[0][1]));
    result = await slash('usage'); assert.match(result.calls[0][1].content, /questions left/, 'and not /ai usage');
    disabledNames = new Set(['ai']);
    result = await slash('usage'); assert.equal(result.calls.length, 1); assert.ok(!/questions left/.test(JSON.stringify(result.calls)), '`ai` stops both');
    disabledNames = new Set(); restrictedNames = new Set(['ask']);
    result = await slash('ask'); assert.equal(result.chat.length, 0, '!restrictcommand ask stops /ai ask'); assert.match(JSON.stringify(result.calls), /Only members with/);
    restrictedNames = new Set(); blockedLevels = new Set(['ask']);
    result = await slash('ask'); assert.equal(result.chat.length, 0, 'a permission level for ask stops /ai ask');
    blockedLevels = new Set();
    result = await slash('ask'); assert.equal(result.chat.length, 1, 'and with no rule it works');
  }

  // ---------------------------------------------------------- 15. what Discord and the people see: options, descriptions, rules, help, the umbrella
  {
    const data = collectCommandData().find((entry) => entry.name === 'ai');
    assert.ok(data, '/ai is registered with Discord');
    assert.equal(data.default_member_permissions ?? null, null, 'open to every member'); assert.equal(data.dm_permission, false, 'servers only');
    assert.deepEqual(data.options.map((option) => [option.name, option.type]), [['ask', 1], ['usage', 1]], 'two subcommands, no loose command without subcommands');
    const question = data.options[0].options[0];
    assert.deepEqual([question.name, question.type, question.required, question.max_length], ['question', 3, true, 800], 'question: string, required, at most 800 characters');
    assert.equal(data.options[1].options?.length ?? 0, 0);
    const nodes = [data, data.options[0], question, data.options[1]];
    for (const node of nodes) {
      assert.ok(node.description && node.description.length <= 100, `${node.name}: description up to 100 characters`);
      for (const locale of ['es-ES', 'pt-BR']) {
        const text = node.description_localizations?.[locale];
        assert.ok(text && text.length <= 100 && text !== node.description, `${node.name} (${locale}): translated, up to 100 characters`);
      }
    }
    assert.ok(collectCommandData().length === 67, 'the registered commands are 67');
    assert.deepEqual(aiCommand.ruleKeys, { ask: 'ask', usage: 'askusage' }, 'a rule on ask or askusage reaches the subcommand');
    assert.deepEqual(require('../src/utils/commandRules').ruleNames(aiCommand, { subcommand: 'ask' }), ['ask', 'ai']);
    assert.deepEqual(require('../src/utils/commandRules').ruleNames(aiCommand, { subcommand: 'usage' }), ['askusage', 'ai']);
    assert.equal(aiCommand.permissionForSubcommand('ask'), null); assert.equal(aiCommand.permissionForSubcommand('usage'), null);
    assert.ok(client.commandRoutes.has('ask') && client.commandRoutes.has('askusage'), '`!ask` and `!askusage` are routes of /ai');
    assert.ok(!client.commands.has('ask') && !client.commandAliases.has('ask'), 'and nothing else takes the word `ask`');
    // `!help ask` and `!help ai` show it, in the category of the utility commands, with the way to write it.
    for (const word of ['ask', 'ai', 'ai ask', 'ai usage', 'askusage']) {
      resetAll();
      const shown = await typed(`!help ${word}`);
      assert.equal(shown.replies.length, 1, `!help ${word} answers`);
      assert.match(shown.said, /Ask the AI|questions you have left today|Ask the AI questions/, `!help ${word} describes it: ${shown.said.slice(0, 200)}`);
      assert.doesNotMatch(shown.said, /Unknown command|could not find/i);
    }
    for (const lang of ['es', 'pt-BR']) for (const key of ['off', 'unavailable', 'empty', 'tooLong', 'cooldown', 'limit', 'busy', 'failed', 'db', 'usage.none', 'usage.unlimited', 'usage.left.one', 'usage.left.other', 'footer', 'footerLeft.one', 'footerLeft.other']) {
      assert.notEqual(t(lang, `utility.ask.${key}`), t('en', `utility.ask.${key}`), `${lang} ${key} is translated`);
    }
    const env = fs.readFileSync(path.join(root, 'docs', 'REFERENCE.md'), 'utf8');
    for (const name of ['ASK_ENABLED', 'ASK_FREE_DAILY', 'ASK_COOLDOWN_FREE_SECONDS', 'ASK_COOLDOWN_PREMIUM_SECONDS', 'ASK_GUILD_PER_HOUR', 'ASK_GLOBAL_PER_MINUTE']) assert.ok(env.includes(name), `${name} is in docs/REFERENCE.md`);
  }

  // ---------------------------------------------------------- 16. in the whole run, nothing a member wrote or the model answered was logged
  {
    const all = logged.join('\n');
    assert.ok(!all.includes('SECRETQUESTION') && !all.includes('SECRETANSWER'), 'no question or answer in any log');
    assert.ok(!/what is the capital of France|and of Spain|hello again|Slash answer/.test(all), `the questions of the pipeline are not in the logs either:\n${all.slice(0, 600)}`);
  }

  console.log('check-ask: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

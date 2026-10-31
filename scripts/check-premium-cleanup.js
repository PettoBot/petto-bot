// Checks the cleanup of Premium that is over (src/jobs/premiumCleanupJob.js): what counts as ended, that a running plan is never touched,
// that the servers it held are reset first and the roles of its owner synced after. The flow runs against a fake pool; the SQL runs against
// a real PostgreSQL database when PETTO_TEST_DATABASE_URL points to a test database that has the schema.
const assert = require('node:assert/strict');
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = process.env.PETTO_TEST_DATABASE_URL || 'postgres://check:check@127.0.0.1:1/check'; // never connected to without the test database
delete process.env.PETTO_CODE_DATABASE_URL;
const job = require('../src/jobs/premiumCleanupJob');

(async () => {
  // The SQL says what the owner asked for.
  assert.match(job.ENDED_SQL, /provider = 'manual'/);
  assert.match(job.ENDED_SQL, /status <> 'active'/, 'a revoked manual grant is over');
  assert.match(job.ENDED_SQL, /current_period_end < now\(\)/, 'a manual grant past its end is over');
  assert.match(job.ENDED_SQL, /status in \('expired', 'canceled'\)/, 'a paid plan is over when expired or canceled');
  assert.match(job.ENDED_SQL, /make_interval\(days => \$1\)/, 'with a grace');
  assert.equal(job.PAID_GRACE_DAYS, 7);

  // The flow, with a fake pool.
  const log = [];
  const pool = {
    async query(sql, params) {
      if (/from premium_entitlements/.test(sql) && /order by id/.test(sql)) {
        log.push(['select', params]);
        return { rows: [{ id: 1, user_id: '111', provider: 'manual' }, { id: 2, user_id: '111', provider: 'manual' }, { id: 3, user_id: '222', provider: 'polar' }, { id: 4, user_id: null, provider: 'manual' }] };
      }
      if (/from premium_slot_assignments/.test(sql)) return { rows: params[0] === 1 ? [{ guild_id: 'g1' }, { guild_id: 'g2' }] : [] };
      if (/^\s*delete from premium_entitlements/.test(sql)) { log.push(['delete', params[0]]); return { rowCount: params[0] === 2 ? 0 : 1 }; } // 2 was extended since the read
      throw new Error(`unexpected query ${sql}`);
    },
  };
  const order = [];
  const result = await job.purgeEndedPremium(null, {
    pool,
    graceDays: 7,
    resetProfile: async (guildId) => { order.push(`reset ${guildId}`); },
    syncRole: async (userId) => { order.push(`sync ${userId}`); },
  });
  assert.equal(result.removed, 3, 'the row that changed since the read stays');
  assert.deepEqual(result.userIds.sort(), ['111', '222']);
  assert.deepEqual(log.filter(([kind]) => kind === 'select')[0][1], [7]);
  assert.deepEqual(log.filter(([kind]) => kind === 'delete').map(([, id]) => id), [1, 2, 3, 4]);
  assert.deepEqual(order, ['reset g1', 'reset g2', 'sync 111', 'sync 222'], 'servers are reset before the delete and the roles synced at the end, once per person');

  // A failure of the reset or the sync does not stop the cleanup.
  const loud = await job.purgeEndedPremium(null, { pool, resetProfile: async () => { throw new Error('discord'); }, syncRole: async () => { throw new Error('roles'); } });
  assert.equal(loud.removed, 3);

  // Nothing ended: nothing happens.
  const quiet = await job.purgeEndedPremium(null, { pool: { query: async () => ({ rows: [] }) }, resetProfile: async () => assert.fail('no reset'), syncRole: async () => assert.fail('no sync') });
  assert.deepEqual(quiet, { removed: 0, userIds: [] });

  // The real SQL.
  const url = process.env.PETTO_TEST_DATABASE_URL;
  if (!url) {
    console.log('premium cleanup flow checks passed (the database part was skipped: set PETTO_TEST_DATABASE_URL to run it)');
    return;
  }
  const { getPrimaryPool, closePools } = require('../src/db/postgres');
  const real = getPrimaryPool();
  const U = '9200000000000000';
  const clean = () => real.query("delete from premium_entitlements where user_id like '9200000000000000%'");
  await clean();
  try {
    const add = async (n, { provider, status, end, updated }) => (await real.query(
      `insert into premium_entitlements (user_id, provider, provider_subscription_id, plan_key, status, slot_limit, current_period_end, updated_at)
       values ($1, $2, $3, 'p', $4, 1, $5, coalesce($6, now())) returning id`,
      [`${U}${n}`, provider, `${U}${n}`, status, end, updated],
    )).rows[0].id;
    const live = await add('1', { provider: 'manual', status: 'active', end: null });
    const liveTimed = await add('2', { provider: 'manual', status: 'active', end: new Date(Date.now() + 86_400_000).toISOString() });
    const revoked = await add('3', { provider: 'manual', status: 'expired', end: null });
    const pastEnd = await add('4', { provider: 'manual', status: 'active', end: new Date(Date.now() - 3_600_000).toISOString() });
    const paidRunning = await add('5', { provider: 'polar', status: 'active', end: new Date(Date.now() + 86_400_000).toISOString() });
    const paidFresh = await add('6', { provider: 'polar', status: 'expired', end: new Date(Date.now() - 86_400_000).toISOString() });
    const paidOld = await add('7', { provider: 'polar', status: 'canceled', end: new Date(Date.now() - 10 * 86_400_000).toISOString(), updated: new Date(Date.now() - 9 * 86_400_000).toISOString() });
    const paidPastDue = await add('8', { provider: 'polar', status: 'past_due', end: new Date(Date.now() - 20 * 86_400_000).toISOString(), updated: new Date(Date.now() - 20 * 86_400_000).toISOString() });
    await real.query("insert into guilds (guild_id) values ('9200000000000001') on conflict do nothing");
    await real.query("insert into premium_slot_assignments (entitlement_id, user_id, guild_id, status) values ($1, $2, '9200000000000001', 'active')", [revoked, `${U}3`]);

    const reset = [];
    const synced = [];
    const out = await job.purgeEndedPremium(null, { resetProfile: async (g) => { reset.push(g); }, syncRole: async (u) => { synced.push(u); } });
    const left = new Set((await real.query("select id from premium_entitlements where user_id like '9200000000000000%'")).rows.map((r) => Number(r.id)));
    for (const id of [live, liveTimed, paidRunning, paidFresh, paidPastDue]) assert.ok(left.has(Number(id)), `row ${id} stays`);
    for (const id of [revoked, pastEnd, paidOld]) assert.ok(!left.has(Number(id)), `row ${id} goes`);
    assert.equal((await real.query('select count(*)::int as n from premium_slot_assignments where entitlement_id = $1', [revoked])).rows[0].n, 0, 'its assignments go with it');
    assert.deepEqual(reset, ['9200000000000001'], 'the server it held is reset');
    assert.deepEqual(synced.sort(), [`${U}3`, `${U}4`, `${U}7`].sort(), 'the roles of the owners of the deleted rows are synced');
    assert.ok(out.removed >= 3);
    const again = await job.purgeEndedPremium(null, { resetProfile: async () => {}, syncRole: async () => {} });
    assert.equal(again.userIds.filter((u) => u.startsWith(U)).length, 0, 'a second pass finds nothing of ours');
  } finally {
    await clean();
    await real.query("delete from guilds where guild_id = '9200000000000001'");
    await closePools?.();
  }
  console.log('premium cleanup checks passed (including the database)');
})().catch((error) => { console.error(error); process.exit(1); });

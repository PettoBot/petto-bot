// Forum support against a real PostgreSQL database: schema.sql applies twice, setups are unique per server and per forum, the columns refuse what is out
// of range, posts are indexed by member, a transition only works from the right state, the activity write is throttled, the three questions of the job
// (quiet, solved, untagged) return what the rules in code say, and everything goes with the server. Skipped without PETTO_TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the forum database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
const db = require('../src/db/forums');
const auto = require('../src/utils/forumAutomation');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const G1 = '120000000000000001';
const G2 = '120000000000000002';
const HOUR = 3_600_000; const DAY = 24 * HOUR;

(async () => {
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  await pool.query('delete from guilds where guild_id in ($1, $2)', [G1, G2]);
  await pool.query('insert into guilds (guild_id) values ($1), ($2)', [G1, G2]);

  const a = await db.createSetup(G1, { name: 'support', forum_channel_id: '130000000000000001' });
  assert.deepEqual([a.enabled, a.max_open_per_user, a.cooldown_seconds, a.button_style, a.log_events], [true, 3, 30, 'success', ['opened', 'locked', 'closed', 'solved']], 'the defaults');
  await assert.rejects(db.createSetup(G1, { name: 'support', forum_channel_id: '130000000000000002' }), (e) => e.code === '23505', 'a name once per server');
  await assert.rejects(db.createSetup(G1, { name: 'other', forum_channel_id: '130000000000000001' }), (e) => e.code === '23505', 'a forum once per server');
  const b = await db.createSetup(G2, { name: 'support', forum_channel_id: '130000000000000009' }); assert.notEqual(b.id, a.id, 'another server can use the name');
  await assert.rejects(db.createSetup(G1, { name: 'Bad Name', forum_channel_id: '1' }), (e) => e.code === '23514');
  for (const bad of [{ max_open_per_user: 51 }, { slowmode_seconds: 21601 }, { button_style: 'neon' }, { inactive_action: 'delete' }, { solved_action: 'x' }, { max_tags: 6 }, { first_message_style: 'html' }, { panel_color: 16777216 }, { tag_wait_minutes: 0 }]) {
    await assert.rejects(db.updateSetup(G1, a.id, bad), (e) => e.code === '23514', JSON.stringify(bad));
  }
  assert.equal((await db.getSetup(G1, 'SUPPORT')).id, a.id); assert.equal((await db.getSetup(G1, String(a.id))).name, 'support'); assert.equal(await db.getSetup(G1, b.id), null, 'never the setup of another server');
  assert.equal((await db.getSetupByForum(G1, '130000000000000001')).id, a.id); assert.equal(await db.getSetupByForum(G1, '130000000000000009'), null); assert.equal(await db.countSetups(G1), 1);
  const saved = await db.updateSetup(G1, a.id, { inactive_days: 3, inactive_action: 'close', solved_action: 'close', solved_delay_hours: 2, staff_role_ids: ['123456789012345678'], extra_fields: [{ type: 'short_text', label: 'x' }] });
  assert.deepEqual(saved.staff_role_ids, ['123456789012345678']); assert.equal(saved.extra_fields[0].label, 'x', 'the questions are stored as JSON');

  // posts
  const post = (id, extra = {}) => db.upsertPost({ thread_id: id, guild_id: G1, setup_id: a.id, author_id: '140000000000000001', title: id, ...extra });
  await post('t-open'); await post('t-old', { last_activity_at: new Date(Date.now() - 4 * DAY).toISOString() }); await post('t-solved', { status: 'solved', solved_at: new Date(Date.now() - 3 * HOUR).toISOString() });
  await post('t-fresh-solved', { status: 'solved', solved_at: new Date(Date.now() - HOUR).toISOString() }); await post('t-closed', { status: 'closed', last_activity_at: new Date(Date.now() - 40 * DAY).toISOString() });
  await post('t-tag', { tag_deadline_at: new Date(Date.now() - 1000).toISOString() }); await post('t-tag-later', { tag_deadline_at: new Date(Date.now() + HOUR).toISOString() });
  await assert.rejects(post('t-bad', { status: 'archived' }), (e) => e.code === '23514'); await assert.rejects(post('t-bad2', { source: 'x' }), (e) => e.code === '23514');
  assert.equal((await post('t-open', { title: 'renamed' })).title, 'renamed', 'a post is kept once');
  const state = await db.memberState(a.id, '140000000000000001'); assert.equal(state.open.length, 6, 'open and solved posts count, closed ones do not'); assert.ok(state.lastOpenedAt);
  assert.deepEqual(await db.memberState(a.id, '149'), { open: [], lastOpenedAt: null });
  assert.equal(await db.countPosts(G1, { status: 'open' }), 6); assert.equal(await db.countPosts(G1, { status: 'closed' }), 1); assert.equal((await db.listPosts(G1, { status: 'solved', limit: 1 })).length, 1); assert.equal((await db.listPosts(G2, {})).length, 0);

  // the job asks an index and gets what the rules in code say
  const all = await db.listPosts(G1, { limit: 200 });
  const inCode = (check) => all.filter((p) => check(p)).map((p) => p.thread_id).sort();
  const now = Date.now();
  assert.deepEqual((await db.dueInactive(25)).map((p) => p.thread_id).sort(), inCode((p) => auto.inactiveDue(p, saved, now)), 'quiet posts'); assert.ok((await db.dueInactive(25)).every((p) => p.action === 'close'));
  assert.deepEqual((await db.dueSolved(25)).map((p) => p.thread_id).sort(), inCode((p) => auto.solvedDue(p, saved, now)), 'solved posts'); assert.deepEqual((await db.dueSolved(25)).map((p) => p.thread_id), ['t-solved']);
  assert.deepEqual((await db.dueTag(25)).map((p) => p.thread_id), ['t-tag']);
  assert.equal((await db.dueInactive(1)).length, 1, 'a few at a time');
  await db.updateSetup(G1, a.id, { inactive_days: 0, solved_action: 'none' }); assert.equal((await db.dueInactive(25)).length, 0, 'off means off'); assert.equal((await db.dueSolved(25)).length, 0);

  // a transition only works from the right state, the activity is throttled
  assert.equal((await db.transition('t-open', ['open', 'solved'], { status: 'locked' })).status, 'locked'); assert.equal(await db.transition('t-open', ['open', 'solved'], { status: 'closed' }), null, 'only once');
  assert.equal(await db.touchActivity('t-old'), true); assert.equal(await db.touchActivity('t-old'), false, 'not twice in five minutes'); assert.equal(await db.touchActivity('t-closed'), false, 'a closed post is not touched'); assert.equal(await db.touchActivity('nope'), false);
  assert.equal(await db.touchActivity('t-old', 0), true, 'with no wait it is written');
  assert.equal((await db.updatePost('t-open', { claimed_by: '1' })).claimed_by, '1'); await db.deletePost('t-open'); assert.equal(await db.getPost('t-open'), null);

  // the setup and the server take their posts with them
  await db.deleteSetup(G1, a.id); assert.equal(await db.getPost('t-old'), null, 'the posts of a deleted setup go');
  const c = await db.createSetup(G2, { name: 'second', forum_channel_id: '130000000000000010' }); await db.upsertPost({ thread_id: 'g2', guild_id: G2, setup_id: c.id, author_id: '1' });
  await pool.query('delete from guilds where guild_id in ($1, $2)', [G1, G2]);
  assert.equal(await db.getPost('g2'), null); assert.equal((await pool.query('select count(*)::int as n from forum_setups where guild_id in ($1, $2)', [G1, G2])).rows[0].n, 0, 'everything goes with the server');
  await closePools();
  console.log('Checked the forum tables against a real database: constraints, the member index, the job questions and the cascade.');
})().catch((error) => { console.error(error); process.exit(1); });

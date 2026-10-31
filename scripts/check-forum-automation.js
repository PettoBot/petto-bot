// Forum support, what happens by itself, with a fake clock: quiet posts are locked or closed after their days, solved posts after their hours, a post
// made by hand with no tag is asked for one and closed when the time is over (and left alone when a tag appears), posts of unreachable servers
// or deleted posts do not stop the others, a new post made by hand is adopted only when the setup asks, and a message in a post is written to the
// index at most once in a while.
const assert = require('node:assert/strict');
const fakes = require('./forum-fakes');
const store = fakes.install();
const { ChannelType, Collection } = require('discord.js');
const forumsDb = require('../src/db/forums');
const auto = require('../src/utils/forumAutomation');
const activity = require('../src/events/messageCreateForumActivity');
const createEvent = require('../src/events/threadCreateForum');

const HOUR = 3_600_000; const DAY = 24 * HOUR;
const guild = fakes.makeGuild();
const forum = fakes.makeForum(guild, { tags: [{ name: 'Bug' }, { name: 'Solved' }] });
const client = guild.client;
const author = fakes.makeMember('500000000000000001');

async function post(extra = {}, setupExtra = {}) {
  let setup = store.setups.find((s) => s.forum_channel_id === forum.id);
  if (!setup) setup = await forumsDb.createSetup(guild.id, { name: 'support', forum_channel_id: forum.id });
  Object.assign(setup, setupExtra);
  const thread = fakes.makeThread(guild, forum, { ownerId: client.user.id, appliedTags: ['900'] });
  store.posts.set(thread.id, { thread_id: thread.id, guild_id: guild.id, setup_id: setup.id, author_id: author.id, title: 'T', status: 'open', source: 'panel', opened_at: fakes.iso(), last_activity_at: fakes.iso(), solved_at: null, closed_at: null, tag_deadline_at: null, claimed_by: null, ...extra });
  return thread;
}
const sentText = (thread) => thread.sent.map((p) => fakes.textOf(p.components)).join('\n');
const ago = (ms) => fakes.iso(fakes.clock.now - ms);
const reset = () => { store.setups.length = 0; store.posts.clear(); store.logs.length = 0; auto.skipped.clear(); };

(async () => {
  // ── quiet posts
  reset();
  const quiet = await post({ last_activity_at: ago(4 * DAY) }, { inactive_days: 3, inactive_action: 'close' });
  const lively = await post({ last_activity_at: ago(2 * DAY) });
  const solvedQuiet = await post({ last_activity_at: ago(5 * DAY), status: 'solved', solved_at: ago(5 * DAY) });
  const closedAlready = await post({ last_activity_at: ago(9 * DAY), status: 'closed' });
  let done = await auto.runForumJob(client, { now: fakes.clock.now });
  assert.deepEqual(done, { quiet: 2, solved: 0, tag: 0 }); assert.equal(quiet.archived, true); assert.equal(quiet.locked, true); assert.equal(lively.locked, false); assert.equal(closedAlready.calls.length, 0);
  assert.match(sentText(quiet), /closed because nobody wrote in it for 3 days/); assert.equal(store.posts.get(quiet.id).status, 'closed'); assert.equal(store.posts.get(solvedQuiet.id).status, 'closed', 'a solved post that nobody touches is closed too');
  assert.deepEqual(quiet.calls.filter(([n]) => n === 'send' || n === 'setArchived').map(([n]) => n), ['send', 'setArchived'], 'the card is the last message, then it is archived');
  assert.ok(store.logs.some((l) => l.embed.author.name === 'Forum Post Closed' && l.embed.fields.some((f) => /quiet post/.test(f.value))), 'the log says Petto did it');
  done = await auto.runForumJob(client, { now: fakes.clock.now }); assert.deepEqual(done, { quiet: 0, solved: 0, tag: 0 }, 'nothing is done twice');
  fakes.clock.now += 2 * DAY; done = await auto.runForumJob(client, { now: fakes.clock.now }); assert.equal(done.quiet, 1, 'two days later the lively one is quiet too'); assert.equal(lively.archived, true);
  fakes.clock.now -= 2 * DAY;
  // lock instead of close, also for a post that Discord archived by itself
  reset(); const archived = await post({ last_activity_at: ago(40 * DAY) }, { inactive_days: 30, inactive_action: 'lock' }); archived.archived = true;
  done = await auto.runForumJob(client, { now: fakes.clock.now }); assert.equal(done.quiet, 1); assert.equal(archived.locked, true); assert.equal(archived.archived, false, 'it is opened to be locked'); assert.match(sentText(archived), /locked because nobody wrote/);
  assert.equal(store.posts.get(archived.id).status, 'locked');
  reset(); const off = await post({ last_activity_at: ago(400 * DAY) }); assert.deepEqual(await auto.runForumJob(client, { now: fakes.clock.now }), { quiet: 0, solved: 0, tag: 0 }, 'with 0 days nothing is ever closed');

  // ── solved posts
  reset();
  const s1 = await post({ status: 'solved', solved_at: ago(3 * HOUR) }, { solved_action: 'close', solved_delay_hours: 2 });
  const s2 = await post({ status: 'solved', solved_at: ago(HOUR) }); const s3 = await post({ status: 'solved', solved_at: ago(30 * HOUR) }, { solved_action: 'lock', solved_delay_hours: 24 });
  Object.assign(store.setups[0], { solved_action: 'close', solved_delay_hours: 2 });
  done = await auto.runForumJob(client, { now: fakes.clock.now }); assert.equal(done.solved, 2, 'the ones that waited two hours');
  assert.equal(store.posts.get(s1.id).status, 'closed'); assert.equal(store.posts.get(s3.id).status, 'closed'); assert.equal(store.posts.get(s2.id).status, 'solved', 'one hour is not enough'); assert.match(sentText(s1), /solved 2 hours ago, so it was closed/);
  reset(); const s4 = await post({ status: 'solved', solved_at: ago(30 * HOUR) }, { solved_action: 'lock', solved_delay_hours: 24 }); await auto.runForumJob(client, { now: fakes.clock.now }); assert.equal(s4.locked, true); assert.equal(s4.archived, false); assert.equal(store.posts.get(s4.id).status, 'locked'); assert.match(sentText(s4), /locked/);
  reset(); const s5 = await post({ status: 'solved', solved_at: ago(900 * HOUR) }, { solved_action: 'none' }); assert.equal((await auto.runForumJob(client, { now: fakes.clock.now })).solved, 0, 'none does nothing');

  // ── a post made by hand: adopted only when the setup says so; asked for a tag; closed when the time is over
  reset();
  const setup = await forumsDb.createSetup(guild.id, { name: 'support', forum_channel_id: forum.id, adopt: false, require_tag: true, tag_wait_minutes: 10, guidelines: 'Be kind.', ping_role_ids: ['600000000000000001'] });
  const native = (tags = []) => fakes.makeThread(guild, forum, { name: 'By hand', ownerId: author.id, appliedTags: tags });
  let t1 = native(); await createEvent.execute(t1, true); assert.equal(store.posts.size, 0, 'a setup that does not adopt keeps nothing');
  setup.adopt = true; await createEvent.execute(t1, false); assert.equal(store.posts.size, 0, 'only new posts');
  await createEvent.execute(t1, true);
  const row = store.posts.get(t1.id); assert.equal(row.source, 'native'); assert.equal(row.author_id, author.id); assert.ok(Math.abs(Date.parse(row.tag_deadline_at) - (Date.now() + 10 * 60_000)) < 5000, 'ten minutes to choose a tag');
  assert.match(sentText(t1), /Be kind\./); assert.match(sentText(t1), new RegExp(`<@${author.id}>, this forum needs a tag on every post\\. Choose one in the next 10 minutes`)); assert.equal(store.logs.at(-1).embed.author.name, 'Forum Post Opened');
  const ownPost = fakes.makeThread(guild, forum, { ownerId: client.user.id }); await createEvent.execute(ownPost, true); assert.ok(!store.posts.has(ownPost.id), 'the posts Petto makes are kept when they are made');
  const tagged = native(['900']); await createEvent.execute(tagged, true); assert.equal(store.posts.get(tagged.id).tag_deadline_at, null, 'a post that has a tag is not asked');
  assert.deepEqual(await auto.runForumJob(client, { now: fakes.clock.now }), { quiet: 0, solved: 0, tag: 0 }, 'not yet');
  fakes.clock.now += 11 * 60_000;
  const t2 = native(); await createEvent.execute(t2, true); store.posts.get(t2.id).tag_deadline_at = ago(1000); t2.appliedTags = ['900'];
  done = await auto.runForumJob(client, { now: fakes.clock.now }); assert.equal(done.tag, 1, 'one post was closed'); assert.equal(store.posts.get(t1.id).status, 'closed'); assert.match(sentText(t1), /closed because it got no tag in 10 minutes/);
  assert.equal(store.posts.get(t2.id).tag_deadline_at, null, 'a post that got a tag in time is left alone'); assert.equal(store.posts.get(t2.id).status, 'open');
  fakes.clock.now -= 11 * 60_000;

  // ── posts that cannot be reached do not stop the others
  reset();
  const fine = await post({ last_activity_at: ago(10 * DAY) }, { inactive_days: 1 });
  const elsewhere = await post({ last_activity_at: ago(11 * DAY), guild_id: '999999999999999999' });
  const gone = await post({ last_activity_at: ago(12 * DAY) }); guild.channels.cache.delete(gone.id); guild.channels.fetch = async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); };
  const broken = await post({ last_activity_at: ago(13 * DAY) }); broken.setLocked = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
  done = await auto.runForumJob(client, { now: fakes.clock.now }); assert.equal(done.quiet, 1); assert.equal(fine.archived, true);
  assert.ok(!store.posts.has(gone.id), 'the row of a deleted post is removed'); assert.ok(store.posts.has(elsewhere.id), 'a server that is not there keeps its rows');
  assert.ok(auto.skipped.has(`g:999999999999999999`) && auto.skipped.has(`t:${broken.id}`), 'the unreachable ones are left alone for a while');
  assert.deepEqual(await auto.runForumJob(client, { now: fakes.clock.now }), { quiet: 0, solved: 0, tag: 0 });
  fakes.clock.now += auto.SKIP_MS + 1000; assert.equal(auto.skipped.size > 0, true); assert.equal((await auto.runForumJob(client, { now: fakes.clock.now })).quiet, 0); fakes.clock.now -= auto.SKIP_MS + 1000;
  for (let n = 0; n < auto.MAX_SKIPPED + 20; n += 1) auto.skipped.set(`t:${n}`, 1); await post({ last_activity_at: ago(14 * DAY) }); // the map is bounded when it is written
  guild.channels.fetch = async (id) => guild.channels.cache.get(id) ?? null;

  // ── the predicates match the database (see check-forum-db.js for the SQL)
  const s = { inactive_days: 2, solved_action: 'close', solved_delay_hours: 1 };
  assert.equal(auto.inactiveDue({ status: 'open', last_activity_at: ago(3 * DAY) }, s, fakes.clock.now), true); assert.equal(auto.inactiveDue({ status: 'closed', last_activity_at: ago(3 * DAY) }, s, fakes.clock.now), false);
  assert.equal(auto.solvedDue({ status: 'solved', solved_at: ago(2 * HOUR) }, s, fakes.clock.now), true); assert.equal(auto.solvedDue({ status: 'open', solved_at: ago(2 * HOUR) }, s, fakes.clock.now), false);
  assert.equal(auto.tagDue({ status: 'open', tag_deadline_at: ago(1) }, fakes.clock.now), true); assert.equal(auto.tagDue({ status: 'open', tag_deadline_at: null }, fakes.clock.now), false);

  // ── a message in a post is written at most once in a while
  activity.seen.clear(); let writes = 0; const original = forumsDb.touchActivity; forumsDb.touchActivity = async () => { writes += 1; return true; };
  const msg = (extra = {}) => ({ guild, author: { bot: false }, channel: { id: 'thread1', isThread: () => true, parent: { type: ChannelType.GuildForum } }, ...extra });
  for (let n = 0; n < 50; n += 1) await activity.execute(msg()); assert.equal(writes, 1, 'fifty messages, one write');
  await activity.execute(msg({ author: { bot: true } })); await activity.execute(msg({ channel: { id: 'c', isThread: () => false } })); await activity.execute(msg({ channel: { id: 'th2', isThread: () => true, parent: { type: ChannelType.GuildText } } }));
  assert.equal(writes, 1, 'bots, normal channels and threads of text channels are left alone');
  assert.equal(activity.worthWriting('thread1', Date.now() + 6 * 60_000), true, 'five minutes later it is written again');
  for (let n = 0; n < 1500; n += 1) activity.worthWriting(`x${n}`); assert.ok(activity.seen.size <= 1000, 'the map stays small');
  forumsDb.touchActivity = original;
  // the index write itself (the same condition as the query)
  const row2 = { thread_id: 'q', status: 'open', last_activity_at: ago(10 * 60_000) }; store.posts.set('q', row2); assert.equal(await forumsDb.touchActivity('q'), true); assert.equal(await forumsDb.touchActivity('q'), false, 'not again within five minutes');
  console.log('Checked the forum automation with a fake clock: quiet, solved and untagged posts, adoption, unreachable posts and the activity write.');
})().catch((error) => { console.error(error); process.exit(1); });

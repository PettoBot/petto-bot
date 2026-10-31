// Forum support on the dashboard, the routes of the bot: each one asks for the Forums page with the right access (view for the reads, edit for the panel and the
// actions), the answers have the shape the website reads, the actions are the bot's own (lock, close, solved...) and refuse what does not belong to the
// server, the language of the request is used, and a member by role is checked with the rules (Forums is part of the Tickets section).
const assert = require('node:assert/strict');
const fakes = require('./forum-fakes');
const store = fakes.install();
const { ChannelType } = require('discord.js');
const { registerForumRoutes } = require('../src/web/forumRoutes');
const access = require('../src/web/dashboardRoleAccess');
const forumsDb = require('../src/db/forums');

const guild = fakes.makeGuild();
const forum = fakes.makeForum(guild, { tags: [{ name: 'Bug' }, { name: 'Solved' }] });
const author = fakes.makeMember('500000000000000001', { name: 'author' }); guild.members.cache.set(author.id, author);
const manager = fakes.makeMember('500000000000000009', { perms: ['ManageGuild'] });

const routes = {};
const app = { post: (route, ...fns) => { routes[route.split('/forums/')[1]] = fns.at(-1); } };
const seen = [];
registerForumRoutes(app, { authorize: async (req, res, options) => { seen.push(options); if (req.denied) { res.status(403).json({ ok: false, error: 'no_access' }); return null; } return { guild, member: manager, userId: manager.id }; } });
const call = async (name, body = {}, extra = {}) => {
  const res = { statusCode: 200, headers: {}, body: null, status(code) { res.statusCode = code; return res; }, json(value) { res.body = value; return res; }, set(k, v) { res.headers[k] = v; return res; } };
  seen.length = 0;
  await routes[name]({ params: { guildId: guild.id }, body, query: {}, headers: {}, ...extra }, res);
  return { res, options: seen[0] };
};

(async () => {
  assert.deepEqual(Object.keys(routes).sort(), ['action', 'channels', 'panel', 'ping', 'posts']);
  // access: reads look, changes edit; the page is Forums
  for (const [name, edit] of [['ping', false], ['channels', false], ['posts', false], ['panel', true], ['action', true]]) assert.deepEqual((await call(name, {})).options, { page: 'forums', edit }, name);
  const denied = await call('posts', {}, { denied: true }); assert.equal(denied.res.statusCode, 403);

  // the rules of Dashboard access: the Tickets section opens Forums, a Community or a Moderation rule does not
  assert.equal(access.PAGE_SECTIONS.forums, 'tickets');
  const rules = [{ role_id: 'r1', sections: ['tickets'], can_edit: true }, { role_id: 'r2', sections: ['community'], can_edit: false }, { role_id: 'r3', sections: ['moderation'], can_edit: true }, { role_id: 'r4', sections: ['tickets'], can_edit: false }];
  assert.equal(access.rulesAllow(rules, ['r1'], 'forums', true), true); assert.equal(access.rulesAllow(rules, ['r4'], 'forums', false), true); assert.equal(access.rulesAllow(rules, ['r4'], 'forums', true), false, 'a view rule cannot change');
  assert.equal(access.rulesAllow(rules, ['r2'], 'forums', false), true, 'the old Community rule still opens it, as for tickets'); assert.equal(access.rulesAllow(rules, ['r3'], 'forums', false), false);

  // ping: the website asks first
  const ping = (await call('ping')).res.body; assert.deepEqual(ping, { ok: true, version: 1, max_setups: 5 });

  // channels
  const limited = fakes.makeForum(guild, { name: 'private', tags: [], botPerms: ['ViewChannel'] });
  const channels = (await call('channels')).res.body; assert.equal(channels.ok, true);
  const mine = channels.forums.find((f) => f.id === forum.id); assert.deepEqual(mine.tags.map((tag) => tag.name), ['Bug', 'Solved']); assert.equal(mine.can_post, true);
  const lacking = channels.forums.find((f) => f.id === limited.id); assert.equal(lacking.can_post, false); assert.ok(lacking.missing.includes('ManageThreads'), 'the page says what is missing');

  // posts
  const setup = await forumsDb.createSetup(guild.id, { name: 'support', forum_channel_id: forum.id });
  const thread = fakes.makeThread(guild, forum, { name: 'Help', ownerId: guild.client.user.id });
  for (let n = 0; n < 3; n += 1) store.posts.set(`p${n}`, { thread_id: `p${n}`, guild_id: guild.id, setup_id: setup.id, author_id: author.id, title: `P${n}`, status: n === 2 ? 'closed' : 'open', source: 'panel', opened_at: fakes.iso(), last_activity_at: fakes.iso() });
  store.posts.set(thread.id, { thread_id: thread.id, guild_id: guild.id, setup_id: setup.id, author_id: author.id, title: 'Help', status: 'open', source: 'panel', opened_at: fakes.iso(), last_activity_at: fakes.iso(), claimed_by: null, solved_at: null });
  store.posts.set('foreign', { thread_id: 'foreign', guild_id: 'other', setup_id: 1, author_id: '1', title: 'x', status: 'open', opened_at: fakes.iso() });
  let list = (await call('posts', { status: 'open' })).res; assert.equal(list.body.total, 3); assert.equal(list.body.posts[0].author.name, 'author'); assert.match(list.body.posts[0].url, /discord\.com\/channels/); assert.equal(list.headers['Cache-Control'], 'no-store');
  assert.ok(!list.body.posts.some((p) => p.thread_id === 'foreign'), 'only the posts of this server');
  assert.equal((await call('posts', { status: 'closed' })).res.body.total, 1); assert.equal((await call('posts', { status: 'nonsense' })).res.body.total, 3, 'an unknown state is open');

  // actions
  const act = async (action, extra = {}) => (await call('action', { thread_id: thread.id, action, ...extra })).res;
  let r = await act('lock', { reason: 'spam' }); assert.equal(r.statusCode, 200); assert.equal(thread.locked, true); assert.equal(r.body.status, 'locked'); assert.equal(r.body.message, 'Post locked.');
  assert.match(fakes.textOf(thread.sent.at(-1).components), new RegExp(`<@${manager.id}>: Successfully locked <#${thread.id}>`)); assert.match(fakes.textOf(thread.sent.at(-1).components), /Reason: spam/);
  r = await act('lock'); assert.equal(r.statusCode, 409); assert.match(r.body.message, /already locked/);
  r = await act('unlock'); assert.equal(r.body.status, 'open');
  r = await act('solved'); assert.equal(r.body.status, 'solved'); assert.ok(thread.appliedTags.includes('901'));
  r = await act('unsolved'); assert.equal(r.body.status, 'open');
  thread.calls.length = 0; r = await act('close'); assert.equal(r.body.status, 'closed'); assert.equal(thread.archived, true); assert.deepEqual(thread.calls.map(([n]) => n).filter((n) => n === 'send' || n === 'setArchived'), ['send', 'setArchived']);
  r = await act('reopen'); assert.equal(r.body.status, 'open'); assert.equal(thread.archived, false);
  r = await act('explode'); assert.equal(r.statusCode, 400); r = (await call('action', { thread_id: 'foreign', action: 'lock' })).res; assert.equal(r.statusCode, 404, 'a post of another server is not found');
  r = (await call('action', { thread_id: 'nope', action: 'lock' })).res; assert.equal(r.statusCode, 404);
  guild.channels.cache.delete(thread.id); r = await act('lock'); assert.equal(r.statusCode, 404); assert.match(r.body.message, /does not exist in Discord any more|does not exist/);
  guild.channels.cache.set(thread.id, thread);

  // the panel
  const sent = []; const channel = { id: '830000000000000001', type: ChannelType.GuildText, guild, isThread: () => false, isTextBased: () => true, send: async (p) => { const m = { id: '1', url: 'https://discord.com/channels/1/2/3', author: { id: guild.client.user.id }, edit: async () => m }; sent.push(m); return m; }, messages: { fetch: async () => sent[0] ?? null }, permissionsFor: () => fakes.permissions(['ViewChannel', 'SendMessages']) };
  guild.channels.cache.set(channel.id, channel);
  r = (await call('panel', { setup_id: setup.id, channel_id: channel.id })).res; assert.equal(r.body.ok, true); assert.equal(r.body.message, 'Panel posted.'); assert.equal(sent.length, 1);
  r = (await call('panel', { setup_id: setup.id, channel_id: channel.id })).res; assert.equal(r.body.message, 'Panel updated.'); assert.equal(r.body.edited, true); assert.equal(sent.length, 1);
  r = (await call('panel', { setup_id: setup.id, channel_id: 'x' })).res; assert.equal(r.statusCode, 400); r = (await call('panel', { setup_id: 999 })).res; assert.equal(r.statusCode, 404);
  store.setups.push({ ...setup, id: 50, guild_id: 'other' }); r = (await call('panel', { setup_id: 50, channel_id: channel.id })).res; assert.equal(r.statusCode, 404, 'the setup of another server');

  // the language of the request
  r = (await call('action', { thread_id: thread.id, action: 'nope' }, { headers: { 'accept-language': 'es' }, get: () => 'es', query: { lang: 'es' } })).res; assert.ok(r.statusCode === 400);
  // a failure is told without details
  forumsDb.getPost = async () => { throw new Error('secret database detail'); }; r = (await call('action', { thread_id: thread.id, action: 'lock' })).res; assert.equal(r.statusCode, 500); assert.ok(!/secret/.test(JSON.stringify(r.body)));
  console.log('Checked the forum routes of the dashboard: access, shape, actions, the panel and failures.');
})().catch((error) => { console.error(error); process.exit(1); });

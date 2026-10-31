// Forum support, the tools of a post and the setup commands: who may use each one (the author, the staff of the setup, members with Manage Threads,
// a stranger, the hierarchy), the green card of `!tl`, lock, unlock, close (the card first, then archive), reopen, solved and unsolved (and the Solved
// tag), rename, tags, claim, a message moved into the forum, the panel (posted, then edited), set, status, enable, disable, delete and the list.
const assert = require('node:assert/strict');
const fakes = require('./forum-fakes');
const store = fakes.install();
const { ChannelType, Collection } = require('discord.js');
const forumCommand = require('../src/commands/tickets/forum');
const actions = require('../src/utils/forumActions');
const access = require('../src/utils/forumAccess');
const forumsDb = require('../src/db/forums');

const STAFF = '600000000000000001';
const guild = fakes.makeGuild();
const forum = fakes.makeForum(guild, { tags: [{ name: 'Bug' }, { name: 'Question' }, { name: 'Solved', moderated: true }] });
const author = fakes.makeMember('500000000000000001', { name: 'author', top: 4 });
const helper = fakes.makeMember('500000000000000002', { name: 'helper', roles: [STAFF], top: 5 });
const bigHelper = fakes.makeMember('500000000000000003', { name: 'bighelper', roles: [STAFF], top: 20 });
const mod = fakes.makeMember('500000000000000004', { name: 'mod', perms: ['ManageThreads'], top: 3 });
const admin = fakes.makeMember('500000000000000005', { name: 'admin', perms: ['ManageGuild', 'ManageThreads'], top: 30 });
const lowHelper = fakes.makeMember('500000000000000007', { name: 'lowhelper', roles: [STAFF], top: 2 });
const stranger = fakes.makeMember('500000000000000006', { name: 'stranger', top: 1 });
for (const m of [lowHelper, author, helper, bigHelper, mod, admin, stranger]) guild.members.cache.set(m.id, m);

let setup;
async function fresh(extra = {}) {
  store.setups.length = 0; store.posts.clear(); store.logs.length = 0;
  setup = await forumsDb.createSetup(guild.id, { name: 'support', forum_channel_id: forum.id, staff_role_ids: [STAFF], ...extra });
  forum.availableTags = forum.availableTags.map((tag) => ({ ...tag })); // the same tags every time
  const thread = fakes.makeThread(guild, forum, { name: 'Help me', ownerId: guild.client.user.id, appliedTags: ['900'] });
  store.posts.set(thread.id, { thread_id: thread.id, guild_id: guild.id, setup_id: setup.id, author_id: author.id, title: 'Help me', status: 'open', source: 'panel', claimed_by: null, solved_at: null, closed_at: null, opened_at: fakes.iso(), last_activity_at: fakes.iso() });
  return thread;
}
const run = (thread, member, sub, values, options) => { const i = fakes.makeCommand(guild, thread, member, sub, values, options); return forumCommand.execute(i).then(() => i); };
const denied = (promise, pattern) => assert.rejects(promise, (error) => error.userFacing === true && pattern.test(error.message), String(pattern));
const text = (i) => fakes.textOf(i.replies.at(-1).components);

(async () => {
  // ── who may do what
  let thread = await fresh();
  for (const [tool, who, ok] of [
    ['lock', author, false], ['lock', stranger, false], ['lock', helper, true], ['lock', mod, true],
    ['close', author, true], ['close', stranger, false], ['close', helper, true],
    ['solved', author, true], ['solved', stranger, false], ['rename', author, true], ['rename', stranger, false],
    ['reopen', author, false], ['claim', author, false], ['claim', helper, true], ['move', author, false], ['tag', author, false], ['tag', helper, true], ['list', author, false],
  ]) {
    const verdict = access.authorize(tool, who, thread, { setup, post: store.posts.get(thread.id), guild });
    assert.equal(verdict.ok, ok, `${tool} by ${who.displayName}`);
  }
  assert.equal(access.authorize('lock', lowHelper, thread, { setup, post: store.posts.get(thread.id), authorMember: author, guild }).reason, 'hierarchy', 'a staff role cannot act on a post of a higher role');
  assert.equal(access.authorize('lock', helper, thread, { setup, post: store.posts.get(thread.id), authorMember: author, guild }).ok, true);
  await denied(run(thread, lowHelper, 'lock', {}), /higher role than yours/);
  assert.equal(access.authorize('lock', mod, thread, { setup, post: store.posts.get(thread.id), authorMember: author, guild }).ok, true, 'Manage Threads is not held back by the hierarchy');
  assert.equal(access.authorize('close', author, thread, { setup: { ...setup, author_can_close: false }, post: store.posts.get(thread.id), guild }).reason, 'authorOff', 'the author switch');
  assert.equal(access.authorize('close', stranger, thread, { setup, post: store.posts.get(thread.id), guild }).reason, 'authorOnly');

  // ── `!tl`: the green card, quiet, with the reason
  let i = await run(thread, bigHelper, 'lock', { reason: 'off topic' });
  assert.equal(thread.locked, true); assert.match(text(i), new RegExp(`<@${bigHelper.id}>: Successfully locked <#${thread.id}>`)); assert.match(text(i), /Reason: off topic/);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [], repliedUser: false }); assert.equal(store.posts.get(thread.id).status, 'locked');
  assert.equal(store.logs.at(-1).embed.author.name, 'Forum Post Locked'); assert.equal(store.logs.at(-1).embed.fields.find((f) => f.name === 'By').value, `<@${bigHelper.id}>`);
  await denied(run(thread, bigHelper, 'lock', {}), /already locked/);
  await denied(run(thread, stranger, 'unlock', {}), /Only the staff/);
  i = await run(thread, mod, 'unlock', {}); assert.equal(thread.locked, false); assert.match(text(i), /Successfully unlocked/); assert.equal(store.posts.get(thread.id).status, 'open');
  await denied(run(thread, mod, 'unlock', {}), /not locked/);

  // ── errors outside a post
  const plainChannel = { id: '1', isThread: () => false, guild, parent: null };
  await denied(run(plainChannel, mod, 'lock', {}), /not a forum post/);
  const otherForum = fakes.makeForum(guild, { tags: [] });
  const strange = fakes.makeThread(guild, otherForum, { ownerId: author.id });
  await denied(run(strange, author, 'close', {}), /not set up for support posts/); await denied(run(strange, helper, 'lock', {}), /not set up/);
  i = await run(strange, mod, 'lock', {}); assert.equal(strange.locked, true, 'Manage Threads works in any forum, as in Bleed');
  assert.equal(store.logs.at(-1).event, 'forums');

  // ── close: locked, the card first, then archived; reopen
  thread.calls.length = 0; i = await run(thread, author, 'close', { reason: 'done' });
  assert.deepEqual(thread.calls.filter(([name]) => name.startsWith('set')).map(([name, v]) => `${name}:${v}`), ['setLocked:true', 'setArchived:true']);
  assert.match(text(i), /Successfully closed/); assert.equal(store.posts.get(thread.id).status, 'closed'); assert.ok(store.posts.get(thread.id).closed_at);
  assert.equal(store.logs.at(-1).embed.author.name, 'Forum Post Closed');
  await denied(run(thread, mod, 'close', {}), /already closed/); await denied(run(thread, mod, 'lock', {}), /closed/);
  await denied(run(thread, author, 'reopen', {}), /Only the staff/);
  i = await run(thread, helper, 'reopen', {}); assert.equal(thread.archived, false); assert.equal(thread.locked, false); assert.equal(store.posts.get(thread.id).status, 'open'); assert.match(text(i), /opened .* again/);
  await denied(run(thread, helper, 'reopen', {}), /not closed or locked/);

  // ── solved: the Solved tag goes on, unsolved takes it off; the author may, a stranger may not
  await denied(run(thread, stranger, 'solved', {}), /Only the author/);
  i = await run(thread, author, 'solved', {}); assert.deepEqual(thread.appliedTags, ['900', '902']); assert.equal(store.posts.get(thread.id).status, 'solved'); assert.match(text(i), /Marked .* as solved/);
  assert.equal(store.logs.at(-1).embed.author.name, 'Forum Post Solved'); await denied(run(thread, author, 'solved', {}), /already solved/);
  i = await run(thread, author, 'unsolved', {}); assert.deepEqual(thread.appliedTags, ['900']); assert.equal(store.posts.get(thread.id).status, 'open'); await denied(run(thread, author, 'unsolved', {}), /not marked as solved/);
  setup.solved_action = 'close'; setup.solved_delay_hours = 2; i = await run(thread, author, 'solved', {}); assert.match(text(i), /It will be closed <t:\d+:R>/);
  // a forum with no Solved tag: the bot makes one when it may, and says so when it cannot
  const bare = fakes.makeForum(guild, { tags: [{ name: 'Bug' }] }); const barePost = fakes.makeThread(guild, bare, { ownerId: guild.client.user.id });
  store.setups.push({ ...setup, id: 77, forum_channel_id: bare.id, name: 'bare', solved_action: 'none' }); store.posts.set(barePost.id, { thread_id: barePost.id, guild_id: guild.id, setup_id: 77, author_id: author.id, status: 'open', opened_at: fakes.iso() });
  await run(barePost, author, 'solved', {}); assert.equal(bare.availableTags.at(-1).name, 'Solved', 'the tag is made'); assert.equal(bare.availableTags.at(-1).moderated, true);
  const bare2 = fakes.makeForum(guild, { tags: [{ name: 'Bug' }] }); const bare2Post = fakes.makeThread(guild, bare2, { ownerId: guild.client.user.id });
  store.setups.push({ ...setup, id: 78, forum_channel_id: bare2.id, name: 'bare2', solved_action: 'none' }); store.posts.set(bare2Post.id, { thread_id: bare2Post.id, guild_id: guild.id, setup_id: 78, author_id: author.id, status: 'open', opened_at: fakes.iso() });
  guild.members.me.permissions = fakes.permissions(['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ManageThreads']);
  bare2.permissionsFor = () => guild.members.me.permissions; await denied(run(bare2Post, author, 'solved', {}), /no tag for solved posts/);
  guild.members.me.permissions = fakes.permissions(['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ManageThreads', 'CreatePublicThreads', 'ManageChannels', 'AttachFiles']);

  // ── rename, tags, claim
  thread = await fresh();
  i = await run(thread, author, 'rename', { title: '  New   title ' }); assert.equal(thread.name, 'New title'); assert.equal(store.posts.get(thread.id).title, 'New title'); assert.match(text(i), /is now \*\*New title\*\*/);
  await denied(run(thread, author, 'rename', { title: '   ' }), /title cannot be empty/);
  setup.author_can_rename = false; await denied(run(thread, author, 'rename', { title: 'x' }), /authors of the posts cannot/); setup.author_can_rename = true;
  i = await run(thread, helper, 'add', { tag: 'ques' }, { group: 'tag' }); assert.deepEqual(thread.appliedTags, ['900', '901']); assert.match(text(i), /Added the tag \*\*Question\*\*/);
  await denied(run(thread, helper, 'add', { tag: 'question' }, { group: 'tag' }), /already has the tag/); await denied(run(thread, helper, 'add', { tag: 'nothing' }, { group: 'tag' }), /no tag called "nothing"/);
  i = await run(thread, helper, 'remove', { tag: 'Bug' }, { group: 'tag' }); assert.deepEqual(thread.appliedTags, ['901']); await denied(run(thread, helper, 'remove', { tag: 'Bug' }, { group: 'tag' }), /does not have a tag/);
  await denied(run(thread, author, 'add', { tag: 'Bug' }, { group: 'tag' }), /Only the staff/);
  i = await run(thread, stranger, 'list', {}, { group: 'tag' }); assert.match(text(i), /\*\*Question\*\*/); assert.match(text(i), /staff only/);
  i = await run(thread, helper, 'claim', {}); assert.equal(store.posts.get(thread.id).claimed_by, helper.id); assert.match(text(i), new RegExp(`Handled by <@${helper.id}>`));
  await denied(run(thread, helper, 'claim', {}), /already handle/); await denied(run(thread, bigHelper, 'claim', {}), /handled by/);
  await denied(run(thread, bigHelper, 'unclaim', {}), /handled by/); i = await run(thread, mod, 'claim', {}); assert.equal(store.posts.get(thread.id).claimed_by, mod.id, 'Manage Threads takes it over');
  await run(thread, mod, 'unclaim', {}); assert.equal(store.posts.get(thread.id).claimed_by, null); await denied(run(thread, mod, 'unclaim', {}), /Nobody handles/);

  // ── a bot that lacks a permission says which
  guild.members.me.permissions = fakes.permissions(['ViewChannel']); const was = thread.permissionsFor; thread.permissionsFor = (m) => (m.id === guild.members.me.id ? guild.members.me.permissions : was(m));
  await denied(run(thread, mod, 'lock', {}), /missing permissions in the forum: .*Manage Threads/);
  guild.members.me.permissions = fakes.permissions(['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ManageThreads', 'CreatePublicThreads', 'ManageChannels', 'AttachFiles']);

  // ── move a message into the forum
  await fresh({ solved_tag_id: null });
  const textChannel = { id: '800000000000000001', type: ChannelType.GuildText, guild, isThread: () => false, isTextBased: () => true, permissionsFor: (m) => fakes.permissions([...(m.permissions?.toArray?.() ?? []), 'ViewChannel', 'SendMessages']), messages: { fetch: async (id) => messages.get(id) ?? null } };
  guild.channels.cache.set(textChannel.id, textChannel);
  const replies = []; const attach = new Collection([['1', { url: 'https://cdn.discordapp.com/a.png' }]]);
  const message = { id: '810000000000000001', channelId: textChannel.id, content: 'How do I reset my password?\nPlease help', author: { id: author.id, bot: false, username: 'author' }, attachments: attach, member: author, reply: async (p) => { replies.push(p); return p; } };
  const messages = new Map([[message.id, message]]);
  i = await run(textChannel, helper, 'move', { text: '' }, { reference: { messageId: message.id, message } });
  assert.equal(forum.created.length, 1); const moved = forum.created[0];
  assert.equal(moved.options.name, 'How do I reset my password?'); assert.match(moved.options.message.content, /^Original message from <@500000000000000001> in <#800000000000000001>:\n\nHow do I reset my password\?\nPlease help\nhttps:\/\/cdn/);
  const card = fakes.textOf(moved.thread.sent[0].components); assert.match(card, /Original Message/); assert.match(card, /> How do I reset my password\?/); assert.match(card, /Please provide any additional information here\./); assert.match(card, new RegExp(`Created by <@${helper.id}> \\| In the future please always create a post in <#${forum.id}>`));
  assert.equal(store.posts.get(moved.thread.id).source, 'moved'); assert.equal(store.posts.get(moved.thread.id).author_id, author.id);
  assert.match(fakes.textOf(replies[0].components), new RegExp(`Moved the message to <#${moved.thread.id}>`)); assert.deepEqual(replies[0].allowedMentions, { parse: [], users: [author.id], repliedUser: false }, 'the author of the message is told');
  assert.equal(i.replies.length, 0, 'the pointer goes under the moved message');
  const link = `https://discord.com/channels/${guild.id}/${textChannel.id}/${message.id}`;
  i = await run(textChannel, mod, 'move', { text: `${link} support Custom title` }); assert.equal(forum.created[1].options.name, 'Custom title');
  await denied(run(textChannel, author, 'move', { text: link }), /Only the staff/);
  await denied(run(textChannel, helper, 'move', { text: '' }), /Reply to the message/);
  await denied(run(textChannel, helper, 'move', { text: 'https://discord.com/channels/999/1/2' }), /another server/);
  messages.set('820000000000000001', { ...message, id: '820000000000000001', author: { id: '1', bot: true } });
  await denied(run(textChannel, helper, 'move', { text: '820000000000000001' }), /bot cannot be moved/);
  store.setups.push({ ...setup, id: 90, name: 'other', forum_channel_id: otherForum.id });
  await denied(run(textChannel, helper, 'move', { text: link }), /Say which forum/); await denied(run(textChannel, helper, 'move', { text: `${link} nowhere` }), /Say which forum|do not know that forum/);

  // ── the setup commands need Manage Server
  await fresh(); store.setups.length = 0;
  await denied(run(textChannel, mod, 'setup', { forum }), /Manage Server/);
  await denied(run(textChannel, admin, 'setup', { forum: textChannel }), /not a forum channel/);
  i = await run(textChannel, admin, 'setup', { forum, name: 'Help Desk' }); assert.equal(store.setups[0].name, 'help-desk'); assert.match(text(i), /Forum setup `help-desk`/);
  assert.equal(store.setups[0].solved_tag_id, '902', 'the Solved tag of the forum is found');
  await denied(run(textChannel, admin, 'setup', { forum }), /already set up as `help-desk`/);
  for (let n = 0; n < 4; n += 1) { const f = fakes.makeForum(guild, { name: `f${n}` }); await run(textChannel, admin, 'setup', { forum: f }); }
  assert.equal(store.setups.length, 5); await denied(run(textChannel, admin, 'setup', { forum: fakes.makeForum(guild, {}) }), /5 forum setups at most/);
  i = await run(textChannel, admin, 'status', { setup: 'help-desk' }); assert.match(text(i), /Forum setup `help-desk`/); assert.match(text(i), /not posted yet/);
  await denied(run(textChannel, admin, 'status', {}), /more than one forum setup/);
  const here = await run(thread, admin, 'status', {}).catch((e) => e); // typed in a post of a setup forum: that setup
  // set, enable, disable
  i = await run(textChannel, admin, 'set', { setting: 'max-open', value: '7', setup: 'help-desk' }); assert.equal(store.setups[0].max_open_per_user, 7); assert.match(text(i), /Saved \*\*max-open\*\*/);
  await denied(run(textChannel, admin, 'set', { setting: 'max-open', value: 'many', setup: 'help-desk' }), /number from 0 to 50/); await denied(run(textChannel, admin, 'set', { setting: 'nope', value: '1', setup: 'help-desk' }), /no setting called "nope"/);
  await denied(run(textChannel, helper, 'set', { setting: 'max-open', value: '7', setup: 'help-desk' }), /Manage Server/);
  await denied(run(textChannel, admin, 'status', { setup: 'zzz' }), /no setup called "zzz"/);
  i = await run(textChannel, admin, 'disable', { setup: 'help-desk' }); assert.equal(store.setups[0].enabled, false); await denied(run(textChannel, admin, 'disable', { setup: 'help-desk' }), /already off/);
  i = await run(textChannel, admin, 'enable', { setup: 'help-desk' }); assert.equal(store.setups[0].enabled, true);

  // ── the panel: posted, then edited in place, then moved
  const panelChannel = (id) => { const sent = []; const ch = { id, type: ChannelType.GuildText, guild, isThread: () => false, isTextBased: () => true, send: async (p) => { const m = { id: `${id}9${sent.length}`, channelId: id, url: `https://discord.com/channels/${guild.id}/${id}/${sent.length}`, author: { id: guild.client.user.id }, edit: async (e) => { m.edited = e; return m; }, delete: async () => { m.deleted = true; } }; sent.push(m); return m; }, messages: { fetch: async (mid) => sent.find((m) => m.id === mid && !m.deleted) ?? null }, permissionsFor: () => fakes.permissions(['ViewChannel', 'SendMessages']), sent }; guild.channels.cache.set(id, ch); return ch; };
  const c1 = panelChannel('830000000000000001'); const c2 = panelChannel('830000000000000002');
  i = await run(textChannel, admin, 'panel', { channel: c1, setup: 'help-desk' }); assert.equal(c1.sent.length, 1); assert.match(text(i), /Posted the panel of `help-desk`/); assert.equal(store.setups[0].panel_message_id, c1.sent[0].id);
  i = await run(textChannel, admin, 'panel', { channel: c1, setup: 'help-desk' }); assert.equal(c1.sent.length, 1, 're-sending edits the panel'); assert.ok(c1.sent[0].edited); assert.match(text(i), /Updated the panel/);
  await run(textChannel, admin, 'set', { setting: 'panel-text', value: 'Read #rules then press the button', setup: 'help-desk' }); assert.match(fakes.textOf(c1.sent[0].edited.components), /Read #rules/, 'a change of the text redraws the panel');
  await run(textChannel, admin, 'disable', { setup: 'help-desk' }); assert.equal(c1.sent[0].edited.components.at(-1).toJSON().components[0].disabled, true, 'a setup turned off turns the button off');
  await run(textChannel, admin, 'enable', { setup: 'help-desk' });
  i = await run(textChannel, admin, 'panel', { channel: c2, setup: 'help-desk' }); assert.equal(c2.sent.length, 1); assert.equal(c1.sent[0].deleted, true, 'the old panel goes when it moves'); assert.equal(store.setups[0].panel_channel_id, c2.id);
  const voice = { id: '1', isTextBased: () => false }; await denied(run(textChannel, admin, 'panel', { channel: voice, setup: 'help-desk' }), /text channel/);
  const noRights = panelChannel('830000000000000003'); noRights.permissionsFor = () => fakes.permissions(['ViewChannel']); await denied(run(textChannel, admin, 'panel', { channel: noRights, setup: 'help-desk' }), /View Channel and Send Messages/);
  store.setups[0].panel_template = 'gone'; await denied(run(textChannel, admin, 'panel', { channel: c2, setup: 'help-desk' }), /saved design/); store.setups[0].panel_template = null;

  // ── the list (staff) and delete
  const listed = await run(textChannel, mod, 'list', {}); assert.ok(listed.replies.length === 1);
  await denied(run(textChannel, author, 'list', {}), /Only the staff/);
  i = await run(textChannel, admin, 'delete', { setup: 'help-desk' }); assert.ok(!store.setups.some((s) => s.name === 'help-desk')); assert.equal(c2.sent[0].deleted, true); assert.match(text(i), /The posts stay in the forum/);

  // ── the errors of Discord become sentences
  assert.match(actions.describeError({ code: 50013 }, 'en'), /missing a permission/); assert.match(actions.describeError({ code: 10003 }, 'en'), /does not exist/); assert.match(actions.describeError(new Error('x'), 'es'), /Algo salió mal/);
  console.log('Checked the forum tools: permissions of every command, lock, close, solved, rename, tags, claim, move, the panel and the setup.');
})().catch((error) => { console.error(error); process.exit(1); });

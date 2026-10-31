// Forum support, opening a post: the button checks who may open and shows the form; the form is read and the tag is asked (the YAGPDB way); the post
// is made with its tag, first message "Post opened by @user - title", the answers, the guidelines card and the staff ping; and every way it can go
// wrong tells the member alone, in their language, without an unknown interaction (the answer is announced first).
const assert = require('node:assert/strict');
const fakes = require('./forum-fakes');
const store = fakes.install();
const { Collection } = require('discord.js');
const open = require('../src/interactions/forum');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const STAFF_ROLE = '600000000000000001';

const guild = fakes.makeGuild();
const forum = fakes.makeForum(guild, { tags: [{ name: 'Bug' }, { name: 'Question' }, { name: 'Staff only', moderated: true }, { name: 'Solved' }] });
const member = fakes.makeMember('500000000000000001', { name: 'liam' });
guild.members.cache.set(member.id, member);

async function setupWith(extra = {}) {
  store.setups.length = 0; store.posts.clear();
  return require('../src/db/forums').createSetup(guild.id, { name: 'support', forum_channel_id: forum.id, ...extra });
}

/** An interaction as Discord sends it: it records what was answered. */
function fake(customId, kind, extra = {}) {
  const calls = [];
  const interaction = {
    customId, guildId: guild.id, guild, member, user: member.user, locale: 'en-US', pettoLang: 'en', calls, deferred: false, replied: false,
    isButton: () => kind === 'button', isModalSubmit: () => kind === 'modal', isStringSelectMenu: () => kind === 'select',
    deferReply: async (o) => { calls.push(['defer', o]); interaction.deferred = true; },
    reply: async (p) => { calls.push(['reply', p]); interaction.replied = true; },
    editReply: async (p) => { calls.push(['edit', p]); },
    update: async (p) => { calls.push(['update', p]); interaction.replied = true; },
    showModal: async (m) => { calls.push(['modal', m]); },
    last: () => calls.at(-1)[1],
    ...extra,
  };
  return interaction;
}
const form = (title, description, more = []) => ({ fields: new Collection([['forum::title', { value: title }], ['forum::description', { value: description }], ...more]) });
const lastText = (i) => String(i.last().content ?? '');

(async () => {
  // ── the button
  let setup = await setupWith();
  let i = fake(`forum:open:${setup.id}`, 'button');
  await open.handleInteraction(i);
  assert.equal(i.calls[0][0], 'modal', 'the form opens'); assert.equal(i.calls[0][1].toJSON().custom_id, `forum:modal:${setup.id}`);

  i = fake('forum:open:9999', 'button'); await open.handleInteraction(i);
  assert.match(lastText(i), /does not work any more/); assert.equal(i.last().flags, 64, 'told to the member alone');
  setup = await setupWith({ enabled: false }); i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.match(lastText(i), /turned off/);
  setup = await setupWith({ blocked_user_ids: [member.id] }); i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.match(lastText(i), /cannot open posts/);
  setup = await setupWith({ required_role_ids: [STAFF_ROLE] }); i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.match(lastText(i), new RegExp(`<@&${STAFF_ROLE}>`));
  setup = await setupWith({ max_open_per_user: 1 });
  await store.posts.set('t1', { thread_id: 't1', guild_id: guild.id, setup_id: setup.id, author_id: member.id, status: 'open', opened_at: fakes.iso(fakes.clock.now - 3_600_000) });
  i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.match(lastText(i), /already have 1 open posts \(the most is 1\): <#t1>/);
  store.posts.get('t1').status = 'closed'; i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.equal(i.calls[0][0], 'modal', 'a closed post does not count');
  setup = await setupWith({ cooldown_seconds: 600 }); store.posts.set('t2', { thread_id: 't2', guild_id: guild.id, setup_id: setup.id, author_id: member.id, status: 'closed', opened_at: new Date().toISOString() });
  i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.match(lastText(i), /Wait \d+ seconds/);
  setup = await setupWith(); guild.channels.cache.delete(forum.id); i = fake(`forum:open:${setup.id}`, 'button'); await open.handleInteraction(i); assert.match(lastText(i), /deleted or is not a forum/); guild.channels.cache.set(forum.id, forum);

  // ── the form, then the tag, then the post
  setup = await setupWith({ ping_role_ids: [STAFF_ROLE], guidelines: 'Be kind.', slowmode_seconds: 30, extra_fields: [{ type: 'short_text', label: 'Version' }] });
  const version = ['field::version', { value: '1.2.3', type: 4, customId: 'field::version' }];
  let m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Cannot log in', 'It says error 42.', [['field::version', { customId: 'field::version', type: 4, value: '1.2.3' }]]) });
  await open.handleInteraction(m);
  assert.equal(m.calls[0][0], 'defer', 'announced first'); assert.deepEqual(m.calls[0][1], { flags: 64 });
  assert.equal(forum.created.length, 0, 'nothing is made before the tag is picked');
  const asked = m.last(); assert.match(asked.content, /Pick the type of inquiry for \*\*Cannot log in\*\* \(up to 1\)/);
  const menu = asked.components[0].toJSON().components[0];
  assert.deepEqual(menu.options.map((o) => o.label), ['Bug', 'Question'], 'no staff-only tag, no Solved tag'); assert.equal(menu.custom_id, `forum:tags:${setup.id}`);
  assert.deepEqual(asked.components[1].toJSON().components.map((b) => b.custom_id), [`forum:skip:${setup.id}`, `forum:cancel:${setup.id}`]);

  let s = fake(`forum:tags:${setup.id}`, 'select', { values: ['901'] });
  await open.handleInteraction(s);
  assert.equal(forum.created.length, 1); const made = forum.created[0];
  assert.equal(made.options.name, 'Cannot log in'); assert.deepEqual(made.options.appliedTags, ['901']); assert.equal(made.options.rateLimitPerUser, 30);
  assert.match(made.options.message.content, new RegExp(`^Post opened by <@${member.id}> - Cannot log in\\n\\nIt says error 42\\.`)); assert.deepEqual(made.options.message.allowedMentions, { parse: [], users: [member.id] });
  const sent = made.thread.sent.map((p) => fakes.textOf(p.components));
  assert.ok(sent.some((x) => /Version:\*\* 1\.2\.3/.test(x)), 'the answers of the other questions are posted'); assert.ok(sent.some((x) => /Be kind\./.test(x) && new RegExp(`<@&${STAFF_ROLE}>`).test(x)), 'guidelines with the staff ping');
  const ping = made.thread.sent.find((p) => /Be kind/.test(fakes.textOf(p.components))); assert.deepEqual(ping.allowedMentions, { parse: [], roles: [STAFF_ROLE] });
  assert.match(s.last().content, new RegExp(`Your post is ready: <#${made.thread.id}>`)); assert.equal(s.calls[0][0], 'update', 'the menu is answered at once');
  assert.equal(store.posts.get(made.thread.id).author_id, member.id); assert.equal(store.posts.get(made.thread.id).source, 'panel');
  assert.equal(store.logs.at(-1).event, 'forums'); assert.equal(store.logs.at(-1).embed.author.name, 'Forum Post Opened');
  // pressing the menu twice does not make two posts
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['901'] }); await open.handleInteraction(s);
  assert.match(s.last().content, /expired/); assert.equal(forum.created.length, 1);

  // ── a form with no tag to pick makes the post at once; a forum with tags makes the tag optional or required
  const noTags = fakes.makeForum(guild, { tags: [] });
  setup = await setupWith({ forum_channel_id: noTags.id });
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Hi', 'There') }); await open.handleInteraction(m);
  assert.equal(noTags.created.length, 1); assert.match(m.last().content, /Your post is ready/); assert.equal(noTags.created[0].options.appliedTags, undefined);
  setup = await setupWith();
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Skip', 'Me') }); await open.handleInteraction(m);
  assert.equal(m.last().components[1].toJSON().components[0].custom_id, `forum:skip:${setup.id}`, 'a tag that is not required can be skipped');
  const before = forum.created.length; let k = fake(`forum:skip:${setup.id}`, 'button'); await open.handleInteraction(k);
  assert.equal(forum.created.length, before + 1); assert.deepEqual(forum.created.at(-1).options.appliedTags, undefined);
  setup = await setupWith({ require_tag: true });
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Need', 'Tag') }); await open.handleInteraction(m);
  assert.match(m.last().content, /A tag is required/); assert.deepEqual(m.last().components[1].toJSON().components.map((b) => b.custom_id), [`forum:cancel:${setup.id}`], 'no skip button when a tag is required');
  s = fake(`forum:tags:${setup.id}`, 'select', { values: [] }); await open.handleInteraction(s); assert.match(s.last().content, /expired|needs a tag/, 'an empty pick does not make a post');
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Need', 'Tag') }); await open.handleInteraction(m);
  k = fake(`forum:skip:${setup.id}`, 'button'); await open.handleInteraction(k); assert.match(k.last().content, /needs a tag/, 'skipping a required tag is refused');
  const requireFlagForum = fakes.makeForum(guild, { tags: [{ name: 'A' }], requireTag: true });
  setup = await setupWith({ forum_channel_id: requireFlagForum.id });
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Flag', 'Tag') }); await open.handleInteraction(m); assert.match(m.last().content, /A tag is required/, 'a forum that requires tags asks for one');
  // cancel
  setup = await setupWith(); m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Cancel', 'Me') }); await open.handleInteraction(m);
  k = fake(`forum:cancel:${setup.id}`, 'button'); await open.handleInteraction(k); assert.match(k.last().content, /Cancelled/);
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900'] }); await open.handleInteraction(s); assert.match(s.last().content, /expired/, 'cancelled means forgotten');

  // ── tags that must be refused
  setup = await setupWith();
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Mod tag', 'x') }); await open.handleInteraction(m);
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['902'] }); await open.handleInteraction(s); assert.match(s.last().content, /not available any more/, 'a staff-only tag cannot be picked by a member');
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Two', 'x') }); await open.handleInteraction(m);
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900', '901'] }); await open.handleInteraction(s); assert.match(s.last().content, /cannot have that many tags/);
  setup = await setupWith({ max_tags: 2 }); m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Two', 'x') }); await open.handleInteraction(m);
  assert.equal(m.last().components[0].toJSON().components[0].max_values, 2); s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900', '901'] }); await open.handleInteraction(s); assert.match(s.last().content, /ready/);

  // ── the form itself
  setup = await setupWith({ extra_fields: [{ type: 'short_text', label: 'Version' }] });
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('', 'x') }); await open.handleInteraction(m); assert.match(m.last().content, /title cannot be empty/);
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('t', '   ') }); await open.handleInteraction(m); assert.match(m.last().content, /description cannot be empty/);
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('t', 'd', [['field::version', { customId: 'field::version', type: 4, value: '' }]]) }); await open.handleInteraction(m); assert.match(m.last().content, /Fill in "Version"/);
  m = fake('forum:modal:9999', 'modal', { fields: form('t', 'd') }); await open.handleInteraction(m); assert.match(m.last().content, /does not work any more/);
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('t', 'd'), deferReply: async () => { throw Object.assign(new Error('Unknown interaction'), { code: 10062 }); } });
  await open.handleInteraction(m); assert.equal(m.calls.length, 0, 'a late form is dropped without an error');

  // pictures: only pictures are taken, and they are copied into the post
  setup = await setupWith({ ask_images: true, forum_channel_id: noTags.id });
  const file = (name, type) => ({ ID: name, Name: name, URL: `https://cdn.discordapp.com/attachments/1/1/${name}`, Size: PNG.length, Type: type });
  const upload = (...files) => ['field::forum_images', { customId: 'field::forum_images', type: 19, attachments: new Collection(files.map((f) => [f.ID, { id: f.ID, name: f.Name, url: f.URL, size: f.Size, contentType: f.Type }])) }];
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Shot', 'See', [upload(file('a.pdf', 'application/pdf'))]) }); await open.handleInteraction(m);
  assert.match(m.last().content, /takes pictures only, and a\.pdf is not one/); const made2 = noTags.created.length;
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Shot', 'See', [upload(file('a.png', 'image/png'))]) });
  await open.handleInteraction(m, { download: async () => PNG });
  assert.equal(noTags.created.length, made2 + 1); const withFile = noTags.created.at(-1).thread.sent.find((p) => p.files?.length); assert.ok(withFile, 'the picture is uploaded into the post');

  // ── what can change between the form and the post
  setup = await setupWith({ max_open_per_user: 1 });
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('First', 'x') }); await open.handleInteraction(m);
  store.posts.set('late', { thread_id: 'late', guild_id: guild.id, setup_id: setup.id, author_id: member.id, status: 'open', opened_at: fakes.iso(fakes.clock.now - 7_200_000) });
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900'] }); await open.handleInteraction(s); assert.match(s.last().content, /already have 1 open posts/, 'the limit is checked again when the post is made');
  setup = await setupWith(); m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Perm', 'x') }); await open.handleInteraction(m);
  guild.members.me.permissions = fakes.permissions(['ViewChannel']);
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900'] }); await open.handleInteraction(s); assert.match(s.last().content, /missing permissions in the forum: .*Manage Threads/);
  guild.members.me.permissions = fakes.permissions(['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ManageThreads']);
  forum.threads.create = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Boom', 'x') }); await open.handleInteraction(m);
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900'] }); await open.handleInteraction(s); assert.match(s.last().content, /missing a permission/);
  forum.threads.create = async () => { throw new Error('boom'); };
  m = fake(`forum:modal:${setup.id}`, 'modal', { fields: form('Boom', 'x') }); await open.handleInteraction(m);
  s = fake(`forum:tags:${setup.id}`, 'select', { values: ['900'] }); await open.handleInteraction(s); assert.match(s.last().content, /Something went wrong/);
  assert.ok(!/boom/.test(s.last().content), 'internal details stay in the logs');

  // ── in Spanish
  require('../src/i18n').setCachedGuildLanguage(guild.id, 'es');
  setup = await setupWith(); i = fake(`forum:open:9999`, 'button', { pettoLang: undefined }); await open.handleInteraction(i); assert.match(lastText(i), /ya no funciona/);
  require('../src/i18n').setCachedGuildLanguage(guild.id, 'en');

  // ── the drafts stay small
  open.drafts.clear();
  for (let n = 0; n < open.MAX_DRAFTS + 50; n += 1) open.saveDraft(`k${n}`, { title: 't' });
  assert.equal(open.drafts.size, open.MAX_DRAFTS, 'at most so many waiting forms');
  open.saveDraft('old', { title: 't' }, 0); assert.equal(open.takeDraft('old', open.DRAFT_TTL_MS + 1), null, 'a form that waited too long is forgotten');
  console.log('Checked opening a forum post: the button, the form, the tags, the post, the limits and every refusal.');
})().catch((error) => { console.error(error); process.exit(1); });

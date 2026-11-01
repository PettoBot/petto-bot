// Forum support, the rules: a setup is cleaned (limits, ids, lists), `!forum set` reads each kind of value, the form has at most five parts, who may open a
// post, the tags a member can pick, the first message fits what Discord takes, the panel says what YAGPDB's says, the alias `!tl`, no slash command was
// added, and every text of the module exists in English, Spanish and Brazilian Portuguese with the same placeholders.
const assert = require('node:assert/strict');
const fakes = require('./forum-fakes');
fakes.install();
const { Collection, ChannelType } = require('discord.js');
const config = require('../src/utils/forumConfig');
const cards = require('../src/utils/forumCards');
const { CATALOGS, LANGUAGES } = require('../src/i18n');

const text = (payload) => fakes.textOf(payload.components);

(async () => {
  // ── a setup is cleaned
  const clean = config.normalizeSetup({ name: 'My Support!', forum_channel_id: '123456789012345678', max_open_per_user: 999, cooldown_seconds: -4, slowmode_seconds: 99999, button_style: 'neon', panel_color: '#a5ea7a', panel_image: 'http://x.test/a.png', staff_role_ids: ['123456789012345678', 'x', '123456789012345678'], inactive_action: 'delete', log_events: ['opened', 'nope'], panel_title: 'x'.repeat(300), max_tags: 9 });
  assert.equal(clean.name, 'my-support'); assert.equal(clean.max_open_per_user, 50); assert.equal(clean.cooldown_seconds, 0); assert.equal(clean.slowmode_seconds, 21600);
  assert.equal(clean.button_style, 'success'); assert.equal(clean.panel_color, 0xa5ea7a); assert.equal(clean.panel_image, null, 'only https links');
  assert.deepEqual(clean.staff_role_ids, ['123456789012345678']); assert.equal(clean.inactive_action, 'close'); assert.deepEqual(clean.log_events, ['opened']);
  assert.equal(clean.panel_title.length, 200); assert.equal(clean.max_tags, 5);
  assert.deepEqual(config.normalizeSetup({ require_tag: true }), { require_tag: true }, 'only the keys given');
  assert.equal(config.slugName('  ¡Soporte Técnico!  '), 'soporte-tecnico'); assert.equal(config.slugName('***'), '');

  // ── the form: title, description, up to three more questions (pictures count as one); five parts at most
  const questions = [{ type: 'short_text', label: 'Version' }, { type: 'select', label: 'Kind', options: ['A', 'B'] }, { type: 'long_text', label: 'Logs' }, { type: 'short_text', label: 'Extra' }];
  assert.equal(config.extraQuestions(questions).length, 3); assert.equal(config.extraQuestions(questions, true).length, 2);
  const setup = config.withDefaults({ id: 3, name: 'support', forum_channel_id: '123456789012345678', extra_fields: questions, ask_images: true });
  const modal = config.buildOpenModal(setup).toJSON();
  assert.equal(modal.custom_id, 'forum:modal:3'); assert.equal(modal.components.length, 5, 'title, description, two questions and the pictures');
  assert.ok(modal.components.length <= 5); assert.equal(modal.components.at(-1).component.type, 19, 'the last part is a file upload');
  const plain = config.buildOpenModal(config.withDefaults({ id: 4, name: 'a', forum_channel_id: '1' })).toJSON();
  assert.equal(plain.components.length, 2, 'no extra question, no pictures: title and description');
  const fields = new Collection([['forum::title', { value: '  Cannot   log in ' }], ['forum::description', { value: 'It fails.' }]]);
  const read = config.readOpenModal(config.withDefaults({ id: 4, name: 'a', forum_channel_id: '1' }), fields);
  assert.equal(read.title, 'Cannot log in'); assert.equal(read.description, 'It fails.'); assert.deepEqual(read.missing, []);

  // ── who may open a post
  const member = fakes.makeMember('500000000000000001', { roles: ['600000000000000001'] });
  const base = config.withDefaults({ enabled: true });
  assert.equal(config.checkEligibility(base, member), null);
  assert.equal(config.checkEligibility({ ...base, enabled: false }, member).code, 'disabled');
  assert.equal(config.checkEligibility({ ...base, blocked_user_ids: [member.id] }, member).code, 'blocked');
  assert.equal(config.checkEligibility({ ...base, blocked_role_ids: ['600000000000000001'] }, member).code, 'blocked');
  assert.equal(config.checkEligibility({ ...base, required_role_ids: ['600000000000000009'] }, member).code, 'roles');
  assert.equal(config.checkEligibility({ ...base, required_role_ids: ['600000000000000001'] }, member), null);
  const open = [{ thread_id: '1' }, { thread_id: '2' }, { thread_id: '3' }];
  assert.equal(config.checkEligibility(base, member, { open }).code, 'limit'); assert.equal(config.checkEligibility({ ...base, max_open_per_user: 0 }, member, { open }), null, '0 is no limit');
  const now = Date.now();
  assert.equal(config.checkEligibility(base, member, { lastOpenedAt: new Date(now - 10_000).toISOString(), now }).vars.seconds, 20);
  assert.equal(config.checkEligibility(base, member, { lastOpenedAt: new Date(now - 40_000).toISOString(), now }), null);

  // ── tags
  const guild = fakes.makeGuild();
  const forum = fakes.makeForum(guild, { tags: [{ name: 'Bug' }, { name: 'Question' }, { name: 'Staff only', moderated: true }, { name: 'Solved' }] });
  assert.deepEqual(config.tagChoices(forum, base).map((tag) => tag.name), ['Bug', 'Question'], 'no moderated tag and no Solved tag for members');
  assert.deepEqual(config.tagChoices(forum, base, { canModerate: true }).map((tag) => tag.name), ['Bug', 'Question', 'Staff only']);
  assert.deepEqual(config.tagChoices(forum, { ...base, tag_ids: ['901'] }).map((tag) => tag.name), ['Question'], 'only the tags the setup allows');
  assert.equal(config.solvedTagOf(forum, base).name, 'Solved'); assert.equal(config.solvedTagOf(forum, { solved_tag_id: '900' }).name, 'Bug', 'the chosen one wins');
  assert.equal(config.findTag(forum.availableTags, 'que').name, 'Question');

  // ── the first message fits 2000 characters, the description gives way
  const first = config.firstMessageText(base, { user: '<@5>', username: 'x', title: 'Hello', description: 'd'.repeat(3000), tags: 'Bug', server: 'S', forum: '<#1>' });
  assert.ok(first.length <= 2000 && first.startsWith('Post opened by <@5> - Hello'), first.slice(0, 40));
  assert.equal(config.firstMessageText({ ...base, first_message: '{user} asks {title} ({tag})\n{description}' }, { user: '<@5>', title: 'T', description: 'D', tags: 'Bug' }), '<@5> asks T (Bug)\nD');

  // ── `!forum set`
  const roles = (words) => words.split(' ').filter((w) => /^\d+$/.test(w));
  assert.deepEqual(config.parseSetting('max-open', '5').patch, { max_open_per_user: 5 }); assert.equal(config.parseSetting('max-open', '99').key, 'int');
  assert.deepEqual(config.parseSetting('adopt', 'on').patch, { adopt: true }); assert.equal(config.parseSetting('adopt', 'maybe').key, 'bool');
  assert.deepEqual(config.parseSetting('solved-action', 'close').patch, { solved_action: 'close' }); assert.equal(config.parseSetting('solved-action', 'burn').key, 'choice');
  assert.deepEqual(config.parseSetting('guidelines', 'none').patch, { guidelines: null }); assert.deepEqual(config.parseSetting('panel-color', 'a5ea7a').patch, { panel_color: 0xa5ea7a });
  assert.deepEqual(config.parseSetting('staff-roles', '123456789012345678 123456789012345679', { roles }).patch, { staff_role_ids: ['123456789012345678', '123456789012345679'] });
  assert.equal(config.parseSetting('staff-roles', 'nobody', { roles }).key, 'roles'); assert.equal(config.parseSetting('nope', '1').key, 'unknown'); assert.equal(config.parseSetting('max-open', '').key, 'needsValue');
  for (const spec of Object.values(config.SETTINGS)) assert.ok(Object.hasOwn(config.DEFAULTS, spec.column) || /^(panel_|button_|modal_|title_|description_|guidelines|first_message$)/.test(spec.column) || ['solved_tag_id'].includes(spec.column), spec.column);

  // ── move arguments
  assert.deepEqual(config.parseMoveArgs('https://discord.com/channels/1/2/3 support My title', ['support']), { message: { guildId: '1', channelId: '2', messageId: '3' }, forum: 'support', title: 'My title' });
  assert.deepEqual(config.parseMoveArgs('<#123456789012345678> Help me', []), { message: null, forum: '123456789012345678', title: 'Help me' });
  assert.deepEqual(config.parseMoveArgs('', []), { message: null, forum: null, title: '' }); assert.equal(config.parseMoveArgs('123456789012345678 hi').message.messageId, '123456789012345678');

  // ── the panel says what YAGPDB's says, with a button that opens the form
  const panel = cards.buildPanel(psetup = { ...setup, ask_images: false, forum_channel_id: forum.id }, { forum });
  assert.match(text(panel), /Open A Post/); assert.match(text(panel), new RegExp(`create a post in <#${forum.id}>`)); assert.match(text(panel), /describe your issue or question as clearly as possible/);
  assert.match(text(panel), /select the type of inquiry/); assert.match(text(panel), /Image attaching is not supported when filling out the modal, you may do so when the post is open instead\./);
  const button = panel.components.at(-1).toJSON().components[0];
  assert.equal(button.custom_id, 'forum:open:3'); assert.equal(button.label, 'Open post'); assert.equal(button.style, 3); assert.equal(button.disabled, false);
  assert.match(text(cards.buildPanel({ ...psetup, ask_images: true }, { forum })), /attach pictures/);
  assert.doesNotMatch(text(cards.buildPanel(psetup, { forum: fakes.makeForum(guild, { tags: [] }) })), /select the type of inquiry/, 'no tags, no tag step in the text');
  assert.equal(cards.buildPanel({ ...psetup, enabled: false }, { forum }).components.at(-1).toJSON().components[0].disabled, true, 'a setup that is off has its button off');
  assert.match(text(cards.buildPanel({ ...psetup, panel_title: 'Help', panel_description: 'Read #rules first', button_label: 'Ask', button_style: 'primary', button_emoji: '🙋' }, { forum })), /Read #rules first/);
  const custom = cards.buildPanel({ ...psetup, button_label: 'Ask', button_style: 'primary', button_emoji: '🙋' }, { forum }).components.at(-1).toJSON().components[0];
  assert.deepEqual([custom.label, custom.style, custom.emoji.name], ['Ask', 1, '🙋']);
  const design = cards.buildPanel(psetup, { forum, design: { components: [], flags: 32768 } });
  assert.equal(design.components.length, 1, 'a saved design gets the button row under it'); assert.equal(design.flags, 32768);

  // ── the cards of the tools
  const done = cards.buildDone('locked', { actor: '5', thread: '9' });
  assert.match(text(done), /<@5>: Successfully locked <#9>/); assert.deepEqual(done.allowedMentions, { parse: [], repliedUser: false }, 'the mention is quiet');
  assert.equal(done.components[0].toJSON().accent_color, 0xa5ea7a, 'a green card');
  assert.match(text(cards.buildDone('locked', { actor: '5', thread: '9', reason: 'spam' })), /Reason: spam/);

  // ── the alias, and no new slash command
  const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
  assert.deepEqual(DEFAULT_PREFIX_ROUTES.find((route) => route.alias === 'tl'), { alias: 'tl', command: 'forum', args: ['lock'], subcommand: 'lock' });
  assert.equal(DEFAULT_PREFIX_ROUTES.filter((route) => route.alias === 'tl').length, 1, 'tl is not ambiguous');
  const { isCommonWord } = require('../src/utils/commonWords'); assert.equal(isCommonWord('tl'), false);
  const { collectCommandData } = require('../src/handlers/commandHandler');
  const registered = collectCommandData();
  assert.equal(registered.length, 66, 'the registered set is the 38 of before and the third batch of umbrellas, without the six old slash commands that umbrella subcommands replaced (scripts/check-umbrellas-3.js); /forum is one of them, with its own subcommands'); assert.ok(registered.some((json) => json.name === 'forum'));
  const forumCommand = require('../src/commands/tickets/forum'); assert.ok(!forumCommand.prefixOnly && forumCommand.registerSlash === true);
  const shortTable = require('../src/utils/short-aliases.json');
  for (const target of ['forum close', 'forum solved', 'forum panel', 'forum setup']) assert.ok(Object.values(shortTable).includes(target), `${target} has a short alias`);

  // ── the three languages
  const keys = Object.keys(CATALOGS.en).filter((key) => key.startsWith('forums.') || key.startsWith('cmd.tickets.forum') || key.startsWith('web.api.forums') || key === 'config.module.forumconfig.title');
  assert.ok(keys.length > 150);
  for (const lang of LANGUAGES.filter((code) => code !== 'en')) {
    for (const key of keys) {
      assert.ok(CATALOGS[lang][key], `${lang} has ${key}`);
      assert.deepEqual((CATALOGS[lang][key].match(/\{[a-z]+\}/g) ?? []).sort(), (CATALOGS.en[key].match(/\{[a-z]+\}/g) ?? []).sort(), `${lang} ${key} has the same placeholders`);
    }
  }
  console.log('Checked forum support rules: settings, the form, who may open, tags, the panel, the cards, the alias and the three languages.');
})().catch((error) => { console.error(error); process.exit(1); });

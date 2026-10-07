// Checks button responders and panels: names, which roles a click gives or takes, the buttons and the menu of a panel, what
// happens on a click or a choice, and the commands that make them.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
const templates = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => (templates.has(`${guildId}:${name}`) ? { content: undefined, embeds: [{ title: name }], components: [], files: [] } : null) });
let premiumActive = false;
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premiumActive }), getGuildLimits: (premium) => ({ buttonResponders: premium?.active ? 250 : 20, componentPanels: premium?.active ? 50 : 10 }) });

// An in-memory copy of the tables.
let responders = [];
let panels = [];
let nextId = 1;
stub('src/db/responders.js', {
  RESPONDER_DEFAULTS: { label: '', emoji: null, style: 'secondary', reply: '', reply_template: null, give_role_ids: [], remove_role_ids: [], required_role_ids: [], toggle: false },
  PANEL_DEFAULTS: { kind: 'buttons', content: '', embed_template: null, responders: [], placeholder: '', exclusive: false, channel_id: null, message_id: null },
  getById: async (id) => responders.find((row) => String(row.id) === String(id)) ?? null,
  getByName: async (guildId, name) => responders.find((row) => row.guild_id === guildId && row.name === name) ?? null,
  listResponders: async (guildId) => responders.filter((row) => row.guild_id === guildId),
  countResponders: async (guildId) => responders.filter((row) => row.guild_id === guildId).length,
  saveResponder: async (guildId, name, values) => { const old = responders.find((row) => row.guild_id === guildId && row.name === name); const row = { ...(old ?? { id: nextId++ }), ...values, guild_id: guildId, name }; responders = [...responders.filter((item) => item !== old), row]; return row; },
  deleteResponder: async (guildId, name) => { const before = responders.length; responders = responders.filter((row) => !(row.guild_id === guildId && row.name === name)); return responders.length < before; },
  getPanelById: async (id) => panels.find((row) => String(row.id) === String(id)) ?? null,
  getPanel: async (guildId, name) => panels.find((row) => row.guild_id === guildId && row.name === name) ?? null,
  listPanels: async (guildId) => panels.filter((row) => row.guild_id === guildId),
  countPanels: async (guildId) => panels.filter((row) => row.guild_id === guildId).length,
  savePanel: async (guildId, name, values) => { const old = panels.find((row) => row.guild_id === guildId && row.name === name); const row = { ...(old ?? { id: nextId++ }), ...values, guild_id: guildId, name }; panels = [...panels.filter((item) => item !== old), row]; return row; },
  deletePanel: async (guildId, name) => { const before = panels.length; panels = panels.filter((row) => !(row.guild_id === guildId && row.name === name)); return panels.length < before; },
});

const engine = require('../src/utils/responderEngine');
const { panelPayload } = require('../src/utils/panelMessage');
const handlers = require('../src/interactions/responders');
const responderCommand = require('../src/commands/automation/responder');
const panelCommand = require('../src/commands/automation/panel');

const fakeUser = (id, username) => ({ id, username, bot: false, tag: username, globalName: username, displayName: username, createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.example/a.png', bannerURL: () => null, toString: () => `<@${id}>` });
const fakeGuild = (id, roles, over = {}) => ({ id, name: 'Mine', ownerId: 'owner', memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, members: { cache: new Collection(), me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } } }, channels: { cache: new Collection(), fetch: async () => null }, roles: { cache: new Collection(roles.map((role) => [role.id, role])) }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() }, ...over });
const rolesList = [{ id: 'vip', position: 3, managed: false }, { id: 'red', position: 4, managed: false }, { id: 'blue', position: 4, managed: false }, { id: 'boss', position: 20, managed: false }, { id: 'bot', position: 2, managed: true }];
const row = (over) => ({ give_role_ids: [], remove_role_ids: [], required_role_ids: [], toggle: false, ...over });

(async () => {
  // Names.
  assert.equal(engine.normalizeName('  VIP Role '), 'vip-role'); assert.equal(engine.normalizeName('añadir'), null); assert.equal(engine.normalizeName(''), null); assert.equal(engine.normalizeName('x'.repeat(61)), null);

  // What a click does to the roles.
  assert.deepEqual(engine.planRoles(row({ give_role_ids: ['vip'] }), []), { denied: false, add: ['vip'], remove: [], toggledOff: false });
  assert.deepEqual(engine.planRoles(row({ give_role_ids: ['vip'] }), ['vip']), { denied: false, add: [], remove: [], toggledOff: false }, 'giving a role the member has does nothing');
  assert.deepEqual(engine.planRoles(row({ give_role_ids: ['vip'], toggle: true }), ['vip']), { denied: false, add: [], remove: ['vip'], toggledOff: true }, 'a toggle takes it back');
  assert.deepEqual(engine.planRoles(row({ give_role_ids: ['vip'], remove_role_ids: ['red', 'vip'] }), ['red']), { denied: false, add: ['vip'], remove: ['red'], toggledOff: false }, 'a role is not given and taken at once');
  assert.equal(engine.planRoles(row({ required_role_ids: ['boss'] }), ['vip']).denied, true); assert.equal(engine.planRoles(row({ required_role_ids: ['boss', 'vip'] }), ['vip']).denied, false, 'any of the required roles is enough');
  const red = row({ id: 1, give_role_ids: ['red'] }); const blue = row({ id: 2, give_role_ids: ['blue', 'vip'] });
  assert.deepEqual(engine.exclusiveRemovals(blue, [red, blue], ['red', 'vip']), ['red'], 'an exclusive menu takes the others back, not what the choice gives');
  assert.equal(engine.describe(['a'], ['b']), 'Added <@&a>. Removed <@&b>.');
  assert.deepEqual(engine.emojiOf('<a:wave:123>'), { id: '123', name: 'wave', animated: true }); assert.equal(engine.emojiOf('two words'), undefined); assert.equal(engine.emojiOf('🌸'), '🌸');

  // The rows of a panel.
  const many = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `r${index + 1}`, label: `Role ${index + 1}`, style: 'success', emoji: null }));
  let rows = engine.panelRows({ id: 9, kind: 'buttons', responders: many.map((item) => item.name) }, many);
  assert.deepEqual(rows.map((item) => item.components.length), [5, 5, 2], 'five buttons to a row'); assert.equal(rows[0].components[0].data.custom_id, 'br:1');
  assert.equal(engine.panelRows({ id: 9, kind: 'buttons', responders: many.map((item) => item.name) }, many, 1).length, 1, 'only the free rows are used');
  rows = engine.panelRows({ id: 9, kind: 'select', placeholder: 'Pick a colour', responders: ['r1', 'r2', 'gone'] }, many);
  assert.equal(rows.length, 1); assert.equal(rows[0].components[0].data.custom_id, 'brs:9'); assert.equal(rows[0].components[0].options.length, 2, 'a responder that was deleted is not shown'); assert.equal(rows[0].components[0].data.min_values, 0);
  assert.deepEqual(engine.panelRows({ id: 9, kind: 'buttons', responders: ['gone'] }, many), []);
  const withTemplate = await panelPayload({ id: 9, name: 'p', kind: 'buttons', content: 'Hi', embed_template: null, responders: ['r1'] }, many, { guild: fakeGuild('g', []) });
  assert.equal(withTemplate.content, 'Hi'); assert.equal(withTemplate.components.length, 1);
  assert.equal((await panelPayload({ id: 9, name: 'rules', kind: 'buttons', content: '', embed_template: null, responders: ['r1'] }, many, { guild: fakeGuild('g', []) })).content, '**rules**', 'a panel with no text still has something to show');

  // A click.
  const replies = [];
  const memberRoles = (ids) => ({ cache: new Collection(ids.map((id) => [id, { id }])), add: async function (list) { for (const id of list) this.cache.set(id, { id }); }, remove: async function (list) { for (const id of list) this.cache.delete(id); } });
  const click = (id, { roles = [], guild = fakeGuild('g1', rolesList), values = null } = {}) => ({
    customId: id, guild, user: fakeUser('u1', 'Mia'), channel: { id: 'c' }, member: { id: 'u1', user: fakeUser('u1', 'Mia'), displayName: 'Mia', displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1, roles: memberRoles(roles) }, values,
    reply: async (payload) => { replies.push(payload); }, deferUpdate: async () => { replies.push('deferred'); },
  });
  responders = [
    { id: 1, guild_id: 'g1', name: 'vip', label: 'VIP', emoji: null, style: 'success', reply: 'Welcome {user.mention}!', reply_template: null, give_role_ids: ['vip'], remove_role_ids: [], required_role_ids: [], toggle: true },
    { id: 2, guild_id: 'g1', name: 'red', label: 'Red', emoji: null, style: 'danger', reply: '', reply_template: null, give_role_ids: ['red'], remove_role_ids: [], required_role_ids: [], toggle: false },
    { id: 3, guild_id: 'g1', name: 'blue', label: 'Blue', emoji: null, style: 'primary', reply: '', reply_template: null, give_role_ids: ['blue'], remove_role_ids: [], required_role_ids: [], toggle: false },
    { id: 4, guild_id: 'g1', name: 'staff', label: 'Staff', emoji: null, style: 'primary', reply: '', reply_template: null, give_role_ids: ['vip'], remove_role_ids: [], required_role_ids: ['boss'], toggle: false },
    { id: 5, guild_id: 'g1', name: 'big', label: 'Big', emoji: null, style: 'primary', reply: '', reply_template: null, give_role_ids: ['boss', 'bot'], remove_role_ids: [], required_role_ids: [], toggle: false },
    { id: 6, guild_id: 'g1', name: 'fancy', label: 'Fancy', emoji: null, style: 'primary', reply: 'text', reply_template: 'card', give_role_ids: [], remove_role_ids: [], required_role_ids: [], toggle: false },
    { id: 7, guild_id: 'other', name: 'alien', label: 'Alien', emoji: null, style: 'primary', reply: '', reply_template: null, give_role_ids: ['vip'], remove_role_ids: [], required_role_ids: [], toggle: false },
  ];
  let interaction = click('br:1'); await handlers.handleButton(interaction);
  assert.deepEqual([...interaction.member.roles.cache.keys()], ['vip'], 'the role is given'); assert.match(replies.at(-1).content, /^Welcome <@u1>!/); assert.equal(replies.at(-1).flags, MessageFlags.Ephemeral, 'the answer is private');
  interaction = click('br:1', { roles: ['vip'] }); await handlers.handleButton(interaction);
  assert.deepEqual([...interaction.member.roles.cache.keys()], [], 'a second click takes it back');
  interaction = click('br:2'); await handlers.handleButton(interaction); assert.match(replies.at(-1).content, /Added <@&red>/);
  interaction = click('br:4', { roles: [] }); await handlers.handleButton(interaction); assert.match(replies.at(-1).content, /You need one of these roles/); assert.equal(interaction.member.roles.cache.size, 0);
  interaction = click('br:5'); await handlers.handleButton(interaction); assert.match(replies.at(-1).content, /above mine or managed/); assert.equal(interaction.member.roles.cache.size, 0, 'a role above the bot is never given');
  templates.set('g1:card', true); interaction = click('br:6'); await handlers.handleButton(interaction);
  assert.deepEqual(replies.at(-1).embeds, [{ title: 'card' }]); assert.ok(replies.at(-1).flags & MessageFlags.Ephemeral, 'a saved embed is private too');
  interaction = click('br:7'); await handlers.handleButton(interaction); assert.match(replies.at(-1).content, /not set up anymore/, 'a responder of another server is not used');
  // What a button does to the message it is on, and where its answer goes.
  responders.push({ id: 8, guild_id: 'g1', name: 'close', label: 'Close', emoji: null, style: 'danger', reply: 'Bye {user.mention}', reply_template: null, give_role_ids: [], remove_role_ids: [], required_role_ids: [], toggle: false, delete_message: true, react_emoji: '👍', send_channel_id: null });
  responders.push({ id: 9, guild_id: 'g1', name: 'tell', label: 'Tell', emoji: null, style: 'primary', reply: 'Hello {user.mention}', reply_template: null, give_role_ids: [], remove_role_ids: [], required_role_ids: [], toggle: false, delete_message: false, react_emoji: '<:like:123456789012345678>', send_channel_id: 'room' });
  responders.push({ id: 10, guild_id: 'g1', name: 'staffclose', label: 'Staff close', emoji: null, style: 'danger', reply: '', reply_template: null, give_role_ids: [], remove_role_ids: [], required_role_ids: ['boss'], toggle: false, delete_message: true, react_emoji: null, send_channel_id: null });
  const hostCalls = [];
  const withHost = (id, over = {}) => Object.assign(click(id), { message: { react: async (emoji) => { hostCalls.push(['react', emoji]); }, delete: async () => { hostCalls.push(['delete']); } } }, over);
  interaction = withHost('br:8'); await handlers.handleButton(interaction);
  assert.match(replies.at(-1).content, /^Bye <@u1>/); assert.deepEqual(hostCalls, [['react', '👍'], ['delete']], 'it reacts and then deletes the message the button is on');
  hostCalls.length = 0;
  interaction = withHost('br:10'); await handlers.handleButton(interaction);
  assert.deepEqual(hostCalls, [], 'a member who is not allowed does not delete anything');
  const sentInRoom = [];
  interaction = withHost('br:9', { guild: fakeGuild('g1', rolesList, { channels: { cache: new Collection(), fetch: async (id) => (id === 'room' ? { id: 'room', isTextBased: () => true, send: async (payload) => { sentInRoom.push(payload); } } : null) } }) });
  await handlers.handleButton(interaction);
  assert.equal(sentInRoom[0].content, 'Hello <@u1>', 'the answer goes to the other channel'); assert.match(replies.at(-1).content, /Sent in <#room>/); assert.deepEqual(hostCalls, [['react', 'like:123456789012345678']], 'a custom emoji is used as name:id');
  interaction = click('br:99'); await handlers.handleButton(interaction); assert.match(replies.at(-1).content, /not set up anymore/);
  const noPermission = fakeGuild('g1', rolesList); noPermission.members.me.permissions.has = () => false;
  interaction = click('br:2', { guild: noPermission }); await handlers.handleButton(interaction); assert.match(replies.at(-1).content, /Manage Roles/);

  // A choice of a menu.
  panels = [{ id: 20, guild_id: 'g1', name: 'colours', kind: 'select', content: '', embed_template: null, responders: ['red', 'blue'], placeholder: '', exclusive: true, channel_id: null, message_id: null }, { id: 21, guild_id: 'g1', name: 'open', kind: 'select', content: '', embed_template: null, responders: ['red', 'blue'], placeholder: '', exclusive: false, channel_id: null, message_id: null }];
  interaction = click('brs:20', { roles: ['red'], values: ['3'] }); await handlers.handleSelect(interaction);
  assert.deepEqual([...interaction.member.roles.cache.keys()].sort(), ['blue'], 'an exclusive menu takes the other colour back');
  interaction = click('brs:21', { roles: ['red'], values: ['3'] }); await handlers.handleSelect(interaction);
  assert.deepEqual([...interaction.member.roles.cache.keys()].sort(), ['blue', 'red'], 'a menu that is not exclusive keeps it');
  interaction = click('brs:20', { values: [] }); await handlers.handleSelect(interaction); assert.equal(replies.at(-1), 'deferred', 'clearing a choice does nothing');
  interaction = click('brs:20', { values: ['1'] }); await handlers.handleSelect(interaction); assert.match(replies.at(-1).content, /no longer|not set up/, 'a choice that is not in the panel is refused');
  interaction = click('brs:77', { values: ['3'] }); await handlers.handleSelect(interaction); assert.match(replies.at(-1).content, /not set up anymore/);

  // The commands.
  const talk = async (command, sub, values = {}, extra = {}) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const sent = [];
    const edited = [];
    const channel = { id: 'chan', toString: () => '#chan', isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async (payload) => { sent.push(payload); return { id: `m${sent.length}` }; }, messages: { fetch: async (id) => (extra.existing === id ? { id, edit: async (payload) => { edited.push(payload); return { id }; } } : null) } };
    const guild = fakeGuild('g1', rolesList); guild.channels.fetch = async () => channel;
    const interactionLike = { guild, user: fakeUser('u1', 'Mia'), member: null, channel, options: { getSubcommand: () => sub, getString: pick, getBoolean: pick, getRole: pick, getChannel: (name) => (name in values ? values[name] : null) }, deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); } };
    await command.execute(interactionLike);
    return { text: out.join('\n'), sent, edited };
  };
  responders = []; panels = [];
  assert.match((await talk(responderCommand, 'add', { name: 'Gold Role', label: 'Gold', give: { id: 'vip' }, reply: 'Hi', style: 'success', toggle: true })).text, /`gold-role` is ready/);
  assert.deepEqual([responders[0].name, responders[0].give_role_ids, responders[0].style, responders[0].toggle], ['gold-role', ['vip'], 'success', true]);
  assert.match((await talk(responderCommand, 'add', { name: 'gold-role' })).text, /already exists/);
  assert.match((await talk(responderCommand, 'add', { name: 'bad name!' })).text, /letters, numbers/);
  assert.match((await talk(responderCommand, 'add', { name: 'x', style: 'purple' })).text, /style is one of/);
  assert.match((await talk(responderCommand, 'add', { name: 'x', emoji: 'not an emoji' })).text, /emoji/);
  assert.match((await talk(responderCommand, 'add', { name: 'x', template: 'nope' })).text, /no saved embed/);
  assert.match((await talk(responderCommand, 'edit', { name: 'gold-role', take: { id: 'red' }, clear: 'reply' })).text, /is saved/);
  assert.deepEqual([responders[0].remove_role_ids, responders[0].reply, responders[0].give_role_ids], [['red'], '', ['vip']], 'edit changes only what is given');
  assert.match((await talk(responderCommand, 'edit', { name: 'ghost' })).text, /no responder called/);
  assert.match((await talk(responderCommand, 'edit', { name: 'gold-role', clear: 'nonsense' })).text, /You can clear/);
  assert.match((await talk(responderCommand, 'list')).text, /gold-role[\s\S]*gives <@&vip>[\s\S]*takes <@&red>[\s\S]*toggle/);
  for (let index = 0; index < 19; index += 1) await talk(responderCommand, 'add', { name: `r${index}`, label: `R${index}` });
  assert.equal(responders.length, 20); assert.match((await talk(responderCommand, 'add', { name: 'extra' })).text, /already has 20 button responders\. Premium raises it to 250/);
  premiumActive = true; assert.match((await talk(responderCommand, 'add', { name: 'extra' })).text, /is ready/); premiumActive = false;

  assert.match((await talk(panelCommand, 'create', { name: 'Roles', kind: 'buttons', content: 'Pick one' })).text, /`roles` is ready/);
  assert.match((await talk(panelCommand, 'create', { name: 'bad', kind: 'dial' })).text, /`buttons` or `select`/);
  assert.match((await talk(panelCommand, 'add', { name: 'roles', responder: 'gold-role' })).text, /is in `roles`/);
  assert.match((await talk(panelCommand, 'add', { name: 'roles', responder: 'gold-role' })).text, /already in/);
  assert.match((await talk(panelCommand, 'add', { name: 'roles', responder: 'ghost' })).text, /no responder with that name/);
  assert.match((await talk(panelCommand, 'send', { name: 'empty-one' })).text, /no panel called/);
  let result = await talk(panelCommand, 'send', { name: 'roles', channel: { id: 'chan', toString: () => '#chan', isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async () => ({ id: 'posted1' }), messages: { fetch: async () => null } } });
  assert.match(result.text, /Posted `roles`/); assert.deepEqual([panels[0].channel_id, panels[0].message_id], ['chan', 'posted1']);
  result = await talk(panelCommand, 'send', { name: 'roles' }, { existing: 'posted1' });
  assert.match(result.text, /Updated `roles`/); assert.equal(result.edited.length, 1, 'the posted message is edited, not posted again'); assert.equal(result.sent.length, 0);
  assert.match((await talk(panelCommand, 'edit', { name: 'roles', content: 'New text', exclusive: true, template: 'none' })).text, /is saved/); assert.equal(panels[0].content, 'New text'); assert.equal(panels[0].exclusive, true);
  assert.match((await talk(panelCommand, 'remove', { name: 'roles', responder: 'gold-role' })).text, /is out of/);
  assert.match((await talk(panelCommand, 'send', { name: 'roles' })).text, /Add at least one responder/);
  assert.match((await talk(panelCommand, 'list')).text, /`roles` · buttons · 0 responders/);
  assert.match((await talk(panelCommand, 'delete', { name: 'roles' })).text, /is deleted/); assert.equal(panels.length, 0);
  assert.equal(responderCommand.prefixOnly, true); assert.equal(panelCommand.prefixOnly, true);
  assert.equal(String(responderCommand.data.default_member_permissions), String(1n << 5n)); assert.equal(String(panelCommand.data.default_member_permissions), String(1n << 5n));
  console.log('Checked the button responders and panels: roles, requirements, buttons, menus, private answers and the commands.');
})().catch((error) => { console.error(error); process.exit(1); });

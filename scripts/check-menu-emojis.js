// Checks the icons of Petto's select menus: every emoji of the registry (src/utils/emojis.js) is written the way Discord wants
// (`<:name:id>` or `<a:name:id>`), the 18 icons made for the menus are there with their exact ids, and the options of the menus
// (the report form, the quick setup, the backup menu, the /help categories, the quest list, the forms panel and the filter and
// sort menus of the lists) each carry a custom Petto icon, never a unicode one, with no repeated value and at most 25 options.
// The only options without an icon are the two of /emojis (still and animated), which have no icon yet.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { ChannelType } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
// The lists of disabled commands and of forum posts read the database: made up here.
stub('src/db/disabledCommands.js', { listForGuild: async () => [{ command: 'ban', channel_id: null }, { command: 'kick', channel_id: '20' }] });
stub('src/db/forums.js', { listPosts: async () => [{ thread_id: '30', author_id: '5', status: 'open', opened_at: new Date() }] });

const { EMOJI } = require('../src/utils/emojis');
const { buildPage } = require('../src/utils/pager');
const { CATEGORY_EMOJI, categoryOptions } = require('../src/utils/reportCategories');
const { buildSetupModal } = require('../src/interactions/setupPanel');
const { buildBackupMenuRow } = require('../src/commands/config/backup');
const { categoryMeta } = require('../src/commands/utility/help');
const { buildQuestList } = require('../src/utils/questMessages');
const cards = require('../src/utils/formCards');
require('../src/commands/info/roles');
require('../src/commands/info/emojis');
require('../src/commands/info/channels');
require('../src/commands/info/inrole');
require('../src/commands/automation/disablecommand');
require('../src/commands/tickets/forum');

const CUSTOM = /^<(a?):(\w{2,32}):(\d{15,25})>$/;
const NEW_ICONS = {
  ALL: '<:pe_all:1566294382284513321>',
  AZ: '<:pe_az:1566294388689207337>',
  BACKUP: '<:pe_backup:1566294376483786882>',
  BOT: '<:pe_bot:1566294387959271594>',
  CHANNEL_TEXT: '<:pe_channel_Text:1566294391696531597>',
  CHANNEL_CATEGORY: '<:pe_channel_category:1566294397274955817>',
  CHANNEL_FORUM: '<:pe_channel_forum:1566294394313638079>',
  CHANNEL_VOICE: '<:pe_channel_voice:1566294393152077834>',
  DOWNLOAD: '<:pe_download:1566294379298168913>',
  SPAM: '<:pe_spam:1566294373505957929>',
  SCAM: '<:pe_scam:1566294920942190643>',
  PALETTE: '<:pe_pallete:1566294389997969520>',
  NSFW: '<:pe_nsfw:1566296380513976410>',
  MASK: '<:pe_mask:1566294984016138340>',
  INTEGRATIONS: '<:pe_integrations:1566294377796739125>',
  LINK: '<:pe_Link:1566302127381282829>',
  GEM: '<:pe_gem:1566295308261007450>',
  SPEECH: '<:pe_speech:1566294375053660160>',
};

// Every select menu found inside a built payload or row (any depth).
function menus(node, found = []) {
  if (Array.isArray(node)) { for (const entry of node) menus(entry, found); return found; }
  if (!node || typeof node !== 'object') return found;
  const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
  if (json.type === 3 && Array.isArray(json.options)) found.push(json);
  for (const value of Object.values(json)) if (value && typeof value === 'object') menus(value, found);
  return found;
}

/** The options of a menu are valid and each has a custom icon (`allowNone`: values that have none yet). */
function assertMenu(menu, label, allowNone = []) {
  assert.ok(menu.options.length >= 1 && menu.options.length <= 25, `${label}: 1 to 25 options`);
  assert.equal(new Set(menu.options.map((o) => o.value)).size, menu.options.length, `${label}: no repeated value`);
  for (const option of menu.options) {
    assert.ok(option.label && option.label.length <= 100, `${label}: the label of ${option.value} is 1 to 100 characters`);
    assert.ok(option.value.length <= 100, `${label}: the value of ${option.value} fits`);
    if (allowNone.includes(option.value)) { assert.equal(option.emoji, undefined, `${label}: ${option.value} has no icon yet`); continue; }
    assert.ok(option.emoji?.id && /^\d{15,25}$/.test(option.emoji.id) && /^\w{2,32}$/.test(option.emoji.name), `${label}: ${option.value} has a custom icon, not a unicode one (${JSON.stringify(option.emoji)})`);
  }
}

(async () => {
  // The registry: every icon is a well-formed custom emoji, and the 18 new ones are there with their exact ids.
  for (const [key, value] of Object.entries(EMOJI)) assert.match(value, CUSTOM, `EMOJI.${key} is <:name:id> or <a:name:id>`);
  for (const [key, value] of Object.entries(NEW_ICONS)) assert.equal(EMOJI[key], value, `EMOJI.${key} is ${value}`);
  assert.equal(Object.keys(NEW_ICONS).length, 18);

  // The report form (inside a modal): the eight categories.
  const report = categoryOptions('en');
  assertMenu({ options: report.map((o) => ({ ...o, emoji: o.emoji && { id: CUSTOM.exec(o.emoji)[3], name: CUSTOM.exec(o.emoji)[2] } })) }, 'report categories');
  assert.deepEqual(Object.keys(CATEGORY_EMOJI).sort(), report.map((o) => o.value).sort(), 'every category has an icon');
  assert.equal(CATEGORY_EMOJI.spam, EMOJI.SPAM); assert.equal(CATEGORY_EMOJI.harassment, EMOJI.SPEECH); assert.equal(CATEGORY_EMOJI.hate, EMOJI.SPEECH);
  assert.equal(CATEGORY_EMOJI.nsfw, EMOJI.NSFW); assert.equal(CATEGORY_EMOJI.scam, EMOJI.SCAM); assert.equal(CATEGORY_EMOJI.impersonation, EMOJI.MASK);

  // The quick setup (a string select inside a modal).
  const modal = buildSetupModal({ channels: { cache: new Map() } }, { guild: {}, automod: {}, logs: {}, welcome: {} }, 'en').toJSON();
  const features = menus(modal).find((m) => m.custom_id === 'setup_features');
  assert.ok(features, 'the setup modal has the features menu');
  assertMenu(features, 'setup features');
  const byValue = (menu) => Object.fromEntries(menu.options.map((o) => [o.value, o.emoji.name]));
  assert.equal(byValue(features)['anti-spam'], 'pe_spam'); assert.equal(byValue(features)['anti-alt'], 'pe_mask');

  // The backup menu.
  const backup = menus(buildBackupMenuRow('1', '2', 'en'))[0];
  assertMenu(backup, 'backup');
  assert.equal(byValue(backup).create, 'pe_backup'); assert.equal(byValue(backup).export_latest, 'pe_download');

  // The /help categories (menu options read their icon from here).
  for (const id of ['moderation', 'info', 'welcome', 'automation', 'leveling', 'giveaways', 'tickets', 'config', 'utility', 'misc', 'roleplay', 'fun', 'integrations', 'other']) {
    assert.match(categoryMeta(id, 'en').icon, CUSTOM, `the help icon of ${id} is a custom emoji`);
  }
  assert.equal(categoryMeta('integrations', 'en').icon, EMOJI.LINK);

  // The quest list: every kind of reward.
  const kinds = ['orbs', 'decoration', 'code', 'ingame', 'nitro', 'other'];
  const quests = kinds.map((kind, n) => ({ id: `16${String(n).padStart(17, '0')}`, name: `Quest ${n}`, url: 'https://discord.com/quests/1', expiresAt: new Date(Date.now() + 86_400_000), rewards: [{ kind, name: 'Reward', amount: 200 }], tasks: [{ kind: 'video', label: 'Watch', seconds: 60 }], regions: { include: [], exclude: [] }, global: true, ageGate: false }));
  const questMenu = menus(buildQuestList(quests, { page: 1 }).components)[0];
  assertMenu(questMenu, 'quest list');
  assert.deepEqual(questMenu.options.map((o) => o.emoji.name), ['pe_Nitro1', 'pe_mask', 'pe_ticket', 'pe_f_game', 'pe_gem', 'pe_give']);

  // The forms panel with the menu style honors the emoji of the button, and drops one Discord would refuse.
  const form = (id, button_emoji) => ({ id, title: `Form ${id}`, button_label: null, button_emoji });
  const panel = cards.panelRows([form(1, EMOJI.SPAM), form(2, '🎁'), form(3, 'not an emoji'), form(4, null)], { style: 'select', panelId: 1, lang: 'en' });
  const panelMenu = menus(panel)[0];
  assert.equal(panelMenu.options[0].emoji.id, '1566294373505957929'); assert.equal(panelMenu.options[1].emoji.name, '🎁');
  assert.equal(panelMenu.options[2].emoji, undefined); assert.equal(panelMenu.options[3].emoji, undefined);

  // The filter and sort menus of the lists.
  const collection = (entries) => { const map = new Map(entries.map((e) => [e.id, e])); map.filter = (fn) => collection([...map.values()].filter(fn)); return map; };
  const guild = {
    id: '1', name: 'Test', iconURL: () => null,
    roles: { cache: collection([{ id: '1', name: '@everyone', position: 0, color: 0, createdTimestamp: 0, members: { size: 1 } }, { id: '100', name: 'Role', position: 1, color: 1, createdTimestamp: 1, members: { size: 1 } }]) },
    emojis: { cache: collection([{ id: '9', name: 'wave', animated: false, toString: () => '<:wave:9>' }]) },
    channels: { cache: collection([{ id: '20', type: ChannelType.GuildText, rawPosition: 1, parent: null }]) },
  };
  const lists = [['roles', {}], ['emojis', {}], ['channels', {}], ['inrole', { arg: '100' }], ['blocked', {}], ['forumposts', {}]];
  guild.roles.cache.get('100').members = new Map([['5', { id: '5', displayName: 'm', user: { username: 'm', bot: false }, joinedTimestamp: 1 }]]);
  const seen = {};
  for (const [kind, extra] of lists) {
    const found = menus((await buildPage(kind, { guild, userId: '1', lang: 'en', ...extra })).components);
    assert.ok(found[0], `list ${kind} has a menu`);
    seen[kind] = found[0];
    assertMenu(found[0], `list ${kind}`, kind === 'emojis' ? ['static', 'animated'] : []);
  }
  for (const kind of ['roles', 'emojis', 'channels', 'inrole', 'blocked', 'forumposts']) assert.ok(seen[kind], `the menu of ${kind} was checked`);
  assert.deepEqual(seen.roles.options.map((o) => o.emoji.name), ['pe_mod', 'pe_welcome', 'pe_az', 'pe_rnew', 'pe_calendario', 'pe_pallete', 'pe_rnothing']);
  assert.deepEqual(seen.channels.options.map((o) => o.emoji.name), ['pe_all', 'pe_channel_Text', 'pe_channel_voice', 'pe_channel_forum', 'pe_channel_category']);
  assert.equal(seen.inrole.options[0].emoji.name, 'pe_all'); assert.equal(seen.inrole.options[2].emoji.name, 'pe_bot');
  assert.equal(seen.emojis.options[0].emoji.name, 'pe_all');

  console.log('check-menu-emojis: ok');
})().catch((error) => { console.error(error); process.exit(1); });

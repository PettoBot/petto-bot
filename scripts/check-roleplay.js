// Checks the interaction actions of /act: every action is reached by its word with the prefix (`!hug`, `!hf`) and as a slash subcommand
// with the same code, how the people are named in each form (slash: mentions of both; prefix: names, the typed message already mentions
// them), nobody is notified, a bot or the author is handled, and the gif sources with a faked `fetch` (the next source, the sources
// that are down, the kept pictures, nothing to show).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The counters come from the database: faked here.
const statsPath = require.resolve('../src/db/roleplayStats');
require.cache[statsPath] = { id: statsPath, filename: statsPath, loaded: true, exports: { getRoleplayCounter: async () => 4, recordRoleplayResponse: async () => ({ claimed: true, counterValue: 1 }) } };

const { Collection } = require('discord.js');
const { loadCommands } = require('../src/handlers/commandHandler');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const { ACTIONS, GROUPS, actionRoutes, EMOJIS } = require('../src/utils/actions');
const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
const roleplay = require('../src/utils/roleplay');
const { CATALOGS, LANGUAGES } = require('../src/i18n');

const IMAGE = 'https://cdn.otakugifs.xyz/gifs/hug/abc.gif';
let calls = [];
let behaviour = () => ({ ok: true, json: { url: IMAGE } });
global.fetch = async (url) => {
  calls.push(String(url));
  const answer = behaviour(String(url));
  if (answer.fail) throw new Error('offline');
  return { ok: answer.ok !== false, status: answer.status ?? 200, json: async () => answer.json };
};

(async () => {
  // The actions: 79, in groups Discord accepts, every one with its texts in the three languages.
  assert.equal(ACTIONS.length, 79);
  assert.equal(new Set(ACTIONS.map((action) => action.name)).size, ACTIONS.length, 'no action twice');
  assert.ok(GROUPS.length <= 25 && GROUPS.every((group) => group.actions.length <= 25));
  for (const lang of LANGUAGES) {
    for (const { name } of ACTIONS) {
      for (const part of ['title', 'target', 'self', 'reply.button', 'accepted', 'rejected', 'count.one', 'count.other']) {
        assert.ok(Object.hasOwn(CATALOGS[lang], `roleplay.${name}.${part}`), `${lang} has roleplay.${name}.${part}`);
      }
      assert.ok(CATALOGS[lang][`roleplay.${name}.target`].includes('{actor}') && CATALOGS[lang][`roleplay.${name}.target`].includes('{target}'), `${lang} ${name} names both people`);
      assert.ok(CATALOGS[lang][`roleplay.${name}.reply.button`].length <= 80, `${lang} ${name} button fits`);
    }
  }
  // The old standalone commands are gone: the actions are only subcommands of /act.
  const commandFiles = fs.readdirSync(path.join(__dirname, '..', 'src', 'commands', 'roleplay')).filter((file) => file.endsWith('.js'));
  assert.deepEqual(commandFiles, ['act.js']);

  // The prefix: every action and its aliases are routes to /act.
  const client = { commands: new Collection() };
  loadCommands(client);
  const act = client.commands.get('act');
  assert.ok(act && act.category === 'roleplay');
  for (const route of actionRoutes()) {
    const loaded = client.commandRoutes.get(route.alias);
    assert.ok(loaded, `!${route.alias} is a route`);
    assert.equal(loaded.command, 'act');
    assert.deepEqual(loaded.args, [route.args[0], route.args[1]]);
    assert.equal(loaded.disableName, route.args[1], 'disabling `hug` is that action only');
    assert.equal(client.commands.has(route.alias), false, `${route.alias} is not a command of its own`);
  }
  for (const [alias, name] of [['bf', 'brofist'], ['hh', 'handhold'], ['hf', 'highfive'], ['goodbye', 'bye'], ['hello', 'hi'], ['lol', 'laugh'], ['nope', 'no'], ['unhappy', 'sad'], ['agree', 'yes']]) {
    assert.equal(client.commandRoutes.get(alias).args[1], name, `the old alias !${alias} reaches ${name}`);
  }
  assert.equal(DEFAULT_PREFIX_ROUTES.filter((route) => route.command === 'act').length, actionRoutes().length);
  const help = require('../src/commands/utility/help');
  assert.equal(typeof help.execute, 'function');

  const jsonAct = act.data.toJSON();
  assert.equal(jsonAct.options.length, GROUPS.length);

  // Two members and a bot, in a server of one cached member.
  const user = (id, name, extra = {}) => ({ id, username: name, globalName: extra.globalName ?? null, bot: Boolean(extra.bot), displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}.png` });
  const ana = user('111111111111111111', 'Ana', { globalName: 'Ana *Star*' });
  const bruno = user('222222222222222222', 'Bruno');
  const robot = user('333333333333333333', 'Robot', { bot: true });
  const guild = { id: '444444444444444444', members: { cache: new Collection([[bruno.id, { user: bruno }], [robot.id, { user: robot }]]), fetch: async () => new Collection() } };
  const users = new Map([[ana.id, ana], [bruno.id, bruno], [robot.id, robot]]);
  const botClient = { users: { fetch: async (id) => users.get(id) ?? null }, commands: client.commands };

  /** What `!<typed>` sends, run the way the message event does (the route turns the word into `act group action`). */
  async function viaPrefix(typed, rest) {
    const sent = [];
    const route = client.commandRoutes.get(typed);
    const message = {
      id: '555555555555555555', content: `!${typed} ${rest}`, guild, author: ana, member: { user: ana }, client: botClient,
      channel: { id: '666666666666666666', send: async (payload) => { sent.push(payload); return { edit: async () => {} }; } },
      reply: async (payload) => { sent.push(payload); return { edit: async (next) => { sent.push(next); } }; },
    };
    const interaction = await buildInteractionFromMessage(message, act, [...route.args, rest].filter(Boolean).join(' '));
    interaction.pettoLang = 'en';
    await act.execute(interaction);
    return sent.at(-1);
  }

  /** What `/act <group> <action> user:<target>` sends. */
  async function viaSlash(name, target, lang = 'en') {
    const sent = [];
    const interaction = {
      id: '777777777777777777', user: ana, guild, guildId: guild.id, locale: lang, pettoLang: lang,
      options: { getSubcommand: () => name, getSubcommandGroup: () => GROUPS.find((group) => group.actions.includes(name)).name, getUser: () => target ?? null },
      deferReply: async () => {}, editReply: async (payload) => { sent.push(payload); },
    };
    await act.execute(interaction);
    return sent.at(-1);
  }
  const text = (payload) => payload.embeds[0].data.description;

  for (const [typed, action] of [['hug', 'hug'], ['kiss', 'kiss'], ['slap', 'slap'], ['sip', 'sip'], ['hf', 'highfive']]) {
    const mention = `<@${bruno.id}>`;
    // Prefix: the display names, never a mention (what was typed already shows it), and nobody is notified.
    const prefixed = await viaPrefix(typed, mention);
    assert.ok(!text(prefixed).includes('<@'), `!${typed}: the reply does not repeat the mention`);
    assert.ok(text(prefixed).includes('Bruno') && text(prefixed).includes('Ana \\*Star\\*'), `!${typed}: names the two people, with the markdown of the name escaped`);
    assert.deepEqual(prefixed.allowedMentions.parse, [], `!${typed} notifies nobody`);
    assert.equal(prefixed.components.length, 1, 'the target can answer with a button');
    assert.match(text(prefixed), /has received 4/, 'the counter is shown');
    assert.equal(prefixed.embeds[0].data.image.url, IMAGE);
    // Slash: both people as mentions, nobody is notified.
    const slashed = await viaSlash(action, bruno);
    assert.ok(text(slashed).includes(`<@${ana.id}>`) && text(slashed).includes(mention), `/act ${action}: mentions both people`);
    assert.ok(!text(slashed).includes('Bruno'), 'no plain name next to the mention');
    assert.deepEqual(slashed.allowedMentions.parse, [], `/act ${action} notifies nobody`);
    assert.equal(slashed.allowedMentions.repliedUser, false);
  }
  // The same action, three languages.
  for (const lang of ['es', 'pt-BR']) {
    const slashed = await viaSlash('hug', bruno, lang);
    assert.ok(text(slashed).includes(`<@${ana.id}>`) && text(slashed).includes(`<@${bruno.id}>`));
    assert.notEqual(text(slashed), text(await viaSlash('hug', bruno, 'en')).replace(/ has received.*/s, ''));
  }

  // Alone: the self text, no button. A bot gets the sentence, no button and no counter.
  const alone = await viaPrefix('hug', '');
  assert.ok(!alone.components && text(alone).includes('Ana'), '!hug alone is the self text with no button');
  const aloneSlash = await viaSlash('cry', null);
  assert.ok(text(aloneSlash).includes(`<@${ana.id}>`) && !aloneSlash.components);
  const toBot = await viaSlash('pat', robot);
  assert.ok(text(toBot).includes(`<@${robot.id}>`) && !toBot.components && !/received/.test(text(toBot)), 'a bot cannot answer, so it has no button or counter');
  const toBotPrefix = await viaPrefix('pat', `<@${robot.id}>`);
  assert.ok(!toBotPrefix.components && text(toBotPrefix).includes('Robot'));
  // A member that is not found is not guessed.
  const unknownMember = await viaPrefix('hug', 'nobody-here');
  assert.ok(unknownMember, 'an unknown name is left out, as before');

  // Nothing in a message can ping, whatever the name: an @everyone name stays a text.
  const sneaky = user('888888888888888888', 'everyone', { globalName: '@everyone <@&1> **x**' });
  guild.members.cache.set(sneaky.id, { user: sneaky });
  users.set(sneaky.id, sneaky);
  const sneakyPrefix = await viaPrefix('hug', `<@${sneaky.id}>`);
  assert.deepEqual(sneakyPrefix.allowedMentions.parse, []);
  assert.ok(text(sneakyPrefix).includes('\\*\\*x\\*\\*'), 'the markdown of a name is escaped');

  // The gif sources: all three asked, the first good answer wins, nothing from another host is shown.
  roleplay.resetImageState();
  calls = [];
  behaviour = (url) => (url.includes('waifu.pics') ? { ok: false, status: 500, json: {} } : url.includes('nekos.best') ? { fail: true } : { ok: true, json: { url: IMAGE } });
  assert.equal(await roleplay.fetchActionImage('hug'), IMAGE, 'the next source answers when the others fail');
  assert.equal(calls.length, 3);
  // A source that failed is skipped for a while.
  calls = [];
  assert.equal(await roleplay.fetchActionImage('hug'), IMAGE);
  assert.equal(calls.length, 1, 'only the source that works is asked again');
  assert.ok(calls[0].includes('otakugifs'));
  // Only the new actions' own sources are asked (sip has OtakuGIFs only).
  calls = [];
  behaviour = () => ({ ok: true, json: { url: 'https://cdn.otakugifs.xyz/gifs/sip/x.gif' } });
  assert.equal(await roleplay.fetchActionImage('sip'), 'https://cdn.otakugifs.xyz/gifs/sip/x.gif');
  assert.deepEqual(calls, ['https://api.otakugifs.xyz/gif?reaction=sip']);
  // A link from another host, or without https, is never shown.
  roleplay.resetImageState();
  for (const bad of ['http://cdn.otakugifs.xyz/a.gif', 'https://evil.example/a.gif', 'https://otakugifs.xyz.evil.example/a.gif', 'not a url', 5, null]) {
    assert.equal(roleplay.safeImageUrl(bad), null, `${bad} is refused`);
  }
  assert.equal(roleplay.safeImageUrl('https://nekos.best/api/v2/hug/a.gif'), 'https://nekos.best/api/v2/hug/a.gif');
  behaviour = () => ({ ok: true, json: { url: 'https://evil.example/a.gif' } });
  assert.equal(await roleplay.fetchActionImage('sip'), null, 'a wrong link is the same as no answer');
  // Everything down: a picture kept from before, and when there is none, a short note instead of an error.
  roleplay.resetImageState();
  behaviour = () => ({ ok: true, json: { url: IMAGE } });
  assert.equal(await roleplay.fetchActionImage('hug'), IMAGE);
  behaviour = () => ({ fail: true });
  assert.equal(await roleplay.fetchActionImage('hug'), IMAGE, 'the kept picture is used when every source is down');
  roleplay.resetImageState();
  assert.equal(await roleplay.fetchActionImage('hug'), null);
  assert.equal(await roleplay.fetchActionImage('not-an-action'), null);
  const noGif = await viaSlash('hug', bruno);
  assert.equal(noGif.embeds[0].data.image, undefined, 'no picture');
  assert.ok(noGif.embeds[0].data.footer.text.includes(CATALOGS.en['roleplay.noImage']), 'says so in the footer');
  assert.ok(noGif.embeds[0].data.description, 'the sentence is still sent');
  assert.equal(EMOJIS.hug, '🤗');

  console.log(`Checked the ${ACTIONS.length} actions of /act: routes, both ways of naming the people, no pings, and the gif sources.`);
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });

// Checks that `!help` opens the command browser as it always did, with the link buttons under the menus (the dashboard, the docs, the page
// with every command on the website and the support server), in en, es and pt-BR; that `!help <command>` still explains one command; and
// that no slash command was added.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { Collection, MessageFlags } = require('discord.js');
const guilds = require('../src/db/guilds');
guilds.ensureGuild = async () => ({ prefixes: ['!'], prefix: '!' });
const { loadCommands } = require('../src/handlers/commandHandler');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const { SUPPORT_URL, WIKI_URL, DASHBOARD_URL, COMMANDS_URL, commandsUrl } = require('../src/utils/links');
const { CATALOGS, LANGUAGES } = require('../src/i18n');

(async () => {
  assert.equal(COMMANDS_URL, 'https://petto.sbs/commands');
  assert.equal(commandsUrl('en'), 'https://petto.sbs/commands');
  assert.equal(commandsUrl('es'), 'https://petto.sbs/es/commands');
  assert.equal(commandsUrl('pt-BR'), 'https://petto.sbs/pt-br/commands');
  assert.equal(SUPPORT_URL, 'https://petto.sbs/support');

  const client = { commands: new Collection(), user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' } };
  loadCommands(client);
  const help = client.commands.get('help');
  assert.ok(help && help.registerSlash, '/help is still a slash command');
  assert.deepEqual(help.aliases.sort(), ['h', 'hlp'], 'no new alias');

  const user = { id: '111111111111111111', username: 'ana', bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/u.png' };
  const guild = { id: '222222222222222222', roles: { cache: new Map() }, members: { cache: new Collection(), me: null } };
  const sent = [];
  async function typed(argText, lang = 'en') {
    sent.length = 0;
    const message = {
      id: '1', content: `!help ${argText}`, guild, author: user, member: { user }, client,
      channel: { id: '333333333333333333', send: async (p) => { sent.push(p); return {}; } },
      reply: async (p) => { sent.push(p); return { edit: async () => {}, createMessageComponentCollector: () => ({ on() {}, stop() {} }) }; },
    };
    const interaction = await buildInteractionFromMessage(message, help, argText);
    interaction.pettoLang = lang;
    await help.execute(interaction);
    return sent[0];
  }
  const buttonsOf = (payload) => {
    const out = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return undefined;
      if (node.type === 2 && node.url) out.push({ label: node.label, url: node.url });
      Object.values(node).forEach(walk);
      return undefined;
    }(payload.components.map((component) => component.toJSON())));
    return out;
  };

  // `!help` alone opens the browser, in every language, with the four link buttons.
  for (const lang of LANGUAGES) {
    const payload = await typed('', lang);
    assert.equal(sent.length, 1, 'one message');
    assert.ok(payload.components?.length && (payload.flags & MessageFlags.IsComponentsV2), `${lang}: !help opens the browser`);
    assert.equal(payload.content, undefined, `${lang}: not a plain line`);
    const links = buttonsOf(payload);
    assert.deepEqual(links.map((link) => link.url), [DASHBOARD_URL, WIKI_URL, commandsUrl(lang), SUPPORT_URL], `${lang}: the link buttons`);
    assert.ok(links.every((link) => link.label && link.label.length <= 80), `${lang}: every button has a label`);
    assert.ok(Object.hasOwn(CATALOGS[lang], 'help.commands.button'), `${lang} has the commands button label`);
  }
  assert.notEqual(buttonsOf(await typed('', 'en'))[2].label, buttonsOf(await typed('', 'es'))[2].label, 'the commands button is translated');

  // The words that used to open the browser are not special any more: a command is looked up.
  const full = await typed('full');
  assert.ok(JSON.stringify(full.components.map((c) => c.toJSON())).includes('full'), '!help full is looked up like any word');

  let payload = await typed('ban');
  assert.ok(payload.components?.length, '!help ban explains the command');
  assert.ok(JSON.stringify(payload.components.map((c) => c.toJSON())).includes('ban'));
  payload = await typed('nosuchcommand');
  assert.ok(JSON.stringify(payload.components.map((c) => c.toJSON())).includes('nosuchcommand'), 'an unknown command is still told');

  // The slash command opens the browser, private.
  const slash = [];
  const interaction = {
    guild, guildId: guild.id, user, client, pettoLang: 'en', options: { getString: () => null },
    reply: async (p) => { slash.push(p); return { createMessageComponentCollector: () => ({ on() {}, stop() {} }) }; },
  };
  await help.execute(interaction);
  assert.ok(slash[0].components && (slash[0].flags & MessageFlags.Ephemeral), '/help opens the private browser');
  assert.equal(slash[0].content, undefined);

  console.log('help line checks passed');
})().catch((error) => { console.error(error); process.exit(1); });

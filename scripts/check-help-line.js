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

  // A mistyped command gets the closest ones (also used by the "unknown command" answer: `!bna` says "Did you mean `!ban`?").
  assert.ok(help.suggestCommands(client, 'bna').includes('ban'), 'bna suggests ban');
  assert.ok(help.suggestCommands(client, 'serv').includes('server'), 'a start suggests the command');
  assert.deepEqual(help.suggestCommands(client, 'zzzzqqqq'), [], 'nothing close, nothing suggested');
  for (const lang of LANGUAGES) assert.ok(CATALOGS[lang]['core.unknownCommandSuggest'].includes('{suggestions}'), `${lang} has the suggestion text`);

  // `!help ban` has an entry for each subcommand: a menu jumps to any of them, the arrows still work, and somebody else who presses is told it is not theirs.
  {
    const handlers = [];
    const message = {
      id: '1', content: '!help ban', guild, author: user, member: { user }, client,
      channel: { id: '333333333333333333', send: async () => ({}) },
      reply: async () => ({ id: 'r', edit: async () => {}, createMessageComponentCollector: () => ({ on: (event, handler) => { if (event === 'collect') handlers.push(handler); }, stop() {} }) }),
    };
    const interaction = await buildInteractionFromMessage(message, help, 'ban');
    interaction.pettoLang = 'en';
    const replies = [];
    interaction.reply = async (payload) => { replies.push(payload); return { createMessageComponentCollector: () => ({ on: (event, handler) => { if (event === 'collect') handlers.push(handler); }, stop() {} }) }; };
    await help.execute(interaction);
    const json = replies[0].components.map((component) => component.toJSON());
    const dump = JSON.stringify(json);
    assert.ok(dump.includes('"custom_id":"help_entry:0"'), 'a menu to jump to an entry');
    assert.ok(dump.includes('"custom_id":"help_next"'), 'and the arrows are still there');
    assert.ok(json[0].components.some((component) => component.type === 14), 'a line separates the name and what it does from the fields');
    assert.ok(/"label":"ban /.test(dump), 'each option is an entry of the command');
    assert.ok(handlers.length === 1, 'one collector');
    // Somebody else presses: a private notice, nothing changes.
    const answers = [];
    await handlers[0]({ user: { id: '999999999999999999' }, customId: 'help_next', values: [], reply: async (payload) => { answers.push(['reply', payload]); }, update: async (payload) => { answers.push(['update', payload]); } });
    assert.equal(answers.length, 1); assert.equal(answers[0][0], 'reply');
    assert.equal(answers[0][1].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral, 'private');
    assert.match(answers[0][1].content, /not the \*\*author\*\*/);
    // The author picks the third entry.
    answers.length = 0;
    await handlers[0]({ user: { id: user.id }, customId: 'help_entry:0', values: ['2'], reply: async () => {}, update: async (payload) => { answers.push(payload); } });
    assert.match(JSON.stringify(answers[0].components.map((component) => component.toJSON())), /Entry 3 of \d+/, 'the page of the entry that was chosen');
    // More than 25 entries: one menu for each 25, as "Entries 26-29", every entry reachable.
    const fake = { data: { toJSON: () => ({ name: 'voicemaster' }) } };
    const many = Array.from({ length: 29 }, (_, i) => ({ path: [`sub${i}`], description: 'x' }));
    const rows29 = help.entryPickers(fake, many, 0, 'en').map((row) => row.toJSON().components[0]);
    assert.equal(rows29.length, 2, 'two menus for 29 entries');
    assert.deepEqual(rows29.map((menu) => menu.placeholder), ['Entries 1-25', 'Entries 26-29']);
    assert.deepEqual(rows29.map((menu) => menu.options.length), [25, 4]);
    assert.equal(rows29[1].options[0].value, '25', 'the value is the number of the entry');
    assert.equal(help.entryPickers(fake, many.slice(0, 1), 0, 'en').length, 0, 'one entry needs no menu');
    assert.equal(help.entryPickers(fake, Array.from({ length: 200 }, (_, i) => ({ path: [`s${i}`] })), 0, 'en').length, 4, 'at most four menus; the arrows reach the rest');
    for (const lang of LANGUAGES) for (const key of ['help.entry.placeholder', 'help.entry.range', 'help.notAuthor']) assert.ok(Object.hasOwn(CATALOGS[lang], key), `${lang} has ${key}`);
  }

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

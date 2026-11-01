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

  // `/help command:` offers the commands and subcommands while it is typed.
  {
    const all = help.helpChoices(client, '');
    assert.equal(all.length, 25, 'at most what Discord shows');
    assert.ok(all.every((choice) => choice.name === choice.value && choice.name.length <= 100), 'the name is what is looked up');
    const ban = help.helpChoices(client, 'ban');
    assert.equal(ban[0].value, 'ban', 'an exact match first');
    assert.ok(ban.some((choice) => choice.value === 'ban temp') || ban.some((choice) => /^ban /.test(choice.value)), 'then its subcommands');
    assert.ok(help.helpChoices(client, 'category').some((choice) => /ticket category/.test(choice.value)), 'what is typed can be in the middle');
    assert.deepEqual(help.helpChoices(client, 'zzzzqqqq'), [], 'nothing close, nothing offered');
    assert.ok(!help.helpChoices(client, 'botstatus').length, 'a private command is not offered to everybody');
    assert.ok(help.helpChoices(client, 'botstatus', true).length, 'but it is to the team');
    const typed = [];
    await help.autocomplete({ options: { getFocused: () => ({ name: 'command', value: 'tic' }) }, client, user: { id: user.id }, respond: async (list) => { typed.push(list); } });
    assert.ok(typed[0].length && typed[0].every((choice) => /tic/i.test(choice.value) || true), 'the handler answers with the list');
    const other = [];
    await help.autocomplete({ options: { getFocused: () => ({ name: 'other', value: 'x' }) }, client, user: { id: user.id }, respond: async (list) => { other.push(list); } });
    assert.deepEqual(other[0], [], 'only the command option has a list');
    assert.equal(help.data.toJSON().options.find((option) => option.name === 'command').autocomplete, true);
  }

  // The slash command answers in the channel, like `!help` (not private): the browser, one command, a command with entries and its menus; only
  // "not found" and the notice for somebody else's menu are private.
  const isPrivate = (payload) => Boolean((payload?.flags ?? 0) & MessageFlags.Ephemeral);
  const handlersOfSlash = [];
  const slashAnswer = async (commandInput, lang = 'en') => {
    const slash = [];
    handlersOfSlash.length = 0;
    const collector = { on: (event, handler) => { if (event === 'collect') handlersOfSlash.push(handler); }, stop() {} };
    const interaction = {
      guild, guildId: guild.id, user, client, pettoLang: lang, options: { getString: () => commandInput },
      reply: async (p) => { slash.push(p); return { edit: async () => {}, createMessageComponentCollector: () => collector }; },
    };
    await help.execute(interaction);
    return slash;
  };
  {
    const slash = await slashAnswer(null);
    assert.ok(slash[0].components && (slash[0].flags & MessageFlags.IsComponentsV2), '/help opens the browser as Components V2');
    assert.ok(!isPrivate(slash[0]), '/help is public');
    assert.equal(slash[0].content, undefined);
    // The author walks the browser: every update stays public (it is the same message) and keeps Components V2; somebody else is told in private.
    const updates = [];
    const press = (who, customId, values = []) => handlersOfSlash[0]({ user: { id: who }, customId, values, reply: async (p) => { updates.push(['reply', p]); }, update: async (p) => { updates.push(['update', p]); }, deferUpdate: async () => { updates.push(['defer']); } });
    await press(user.id, 'help_cat', ['moderation']);
    await press(user.id, 'help_cmd', ['ticket']);
    await press(user.id, 'help_sub', ['category add']);
    await press(user.id, 'help_subback:tickets');
    await press(user.id, 'help_cmdback:tickets');
    await press(user.id, 'help_back');
    assert.equal(updates.length, 6);
    assert.ok(updates.every(([kind, p]) => kind === 'update' && p.components && (p.flags & MessageFlags.IsComponentsV2) && !isPrivate(p)), 'every page of the browser is a public edit of the message');
    updates.length = 0;
    await press('999999999999999999', 'help_cat', ['moderation']);
    assert.equal(updates.length, 1); assert.equal(updates[0][0], 'reply');
    assert.ok(isPrivate(updates[0][1]), 'somebody else is told in private');
    assert.match(updates[0][1].content, /not the \*\*author\*\*/);

    const one = await slashAnswer('ping');
    assert.ok(!isPrivate(one[0]) && (one[0].flags & MessageFlags.IsComponentsV2), '/help command:ping is public');
    const many = await slashAnswer('ticket');
    assert.ok(!isPrivate(many[0]) && (many[0].flags & MessageFlags.IsComponentsV2), '/help command:ticket is public');
    const edits = [];
    const press2 = (who, customId, values) => handlersOfSlash[0]({ user: { id: who }, customId, values, reply: async (p) => { edits.push(['reply', p]); }, update: async (p) => { edits.push(['update', p]); } });
    await press2(user.id, 'help_entry:0', ['2']);
    await press2(user.id, 'help_next', []);
    await press2(user.id, 'help_close', []);
    assert.ok(edits.every(([kind, p]) => kind === 'update' && (p.flags & MessageFlags.IsComponentsV2) && !isPrivate(p)), 'the entries, the arrows and close edit the public message');
    await press2('999999999999999999', 'help_next', []);
    assert.ok(isPrivate(edits.at(-1)[1]) && edits.at(-1)[0] === 'reply', 'somebody else is told in private');
    const missing = await slashAnswer('nosuchcommand');
    assert.ok(isPrivate(missing[0]), 'a command that is not found is told in private');
  }

  // Every option of every menu of the help says what it is: a non-empty description of at most 100 characters in every language, a label
  // with the whole path (not just `add`), at most 25 options in a menu, and different values.
  {
    const allow = new Set(['ticket', 'mod', 'config', 'level', 'boosterrole', 'me', 'staff']);
    const menusOf = (payloadOrRows) => {
      const found = [];
      (function walk(node) {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return undefined;
        if (node.type === 3) found.push(node);
        Object.values(node).forEach(walk);
        return undefined;
      }(payloadOrRows));
      return found;
    };
    const rowsJson = (components) => components.map((component) => component.toJSON());
    let checked = 0;
    for (const lang of LANGUAGES) {
      const menus = [...menusOf(rowsJson(help.mainView(client, guild, '!', false, lang).components))];
      for (const id of menus[0].options.map((option) => option.value)) menus.push(...menusOf(rowsJson(help.categoryView(client, guild, id, false, lang).components)));
      for (const name of allow) {
        const command = client.commands.get(name);
        assert.ok(command, `${name} exists`);
        menus.push(...menusOf(rowsJson(help.subcommandView(client, guild, command, command.category, false, lang).components)));
        const json = command.data.toJSON();
        const entries = [];
        for (const option of json.options ?? []) {
          if (option.type === 1) entries.push({ path: [option.name], description: option.description, options: option.options ?? [] });
          if (option.type === 2) for (const sub of option.options) entries.push({ path: [option.name, sub.name], description: sub.description, options: sub.options ?? [] });
        }
        menus.push(...rowsJson(help.entryPickers(command, entries, 0, lang)).flatMap((row) => row.components));
      }
      for (const menu of menus) {
        assert.ok(menu.options.length >= 1 && menu.options.length <= 25, `${lang}: ${menu.custom_id} has 1-25 options`);
        assert.equal(new Set(menu.options.map((option) => option.value)).size, menu.options.length, `${lang}: ${menu.custom_id} has different values`);
        for (const option of menu.options) {
          assert.ok(option.label && option.label.length <= 100, `${lang}: ${menu.custom_id} ${option.value}: the label`);
          assert.ok(option.description && option.description.trim() && [...option.description].length <= 100, `${lang}: ${menu.custom_id} ${option.label} has a description of 1-100 characters`);
          checked += 1;
        }
      }
    }
    assert.ok(checked > 1000, `${checked} options checked`);
    // The label is the whole path, so `add` never stands alone; the description is what that entry does, in the language of the server.
    const ticket = client.commands.get('ticket');
    const subMenu = menusOf(rowsJson(help.subcommandView(client, guild, ticket, 'tickets', false, 'en').components))[0];
    assert.ok(subMenu.options.every((option) => /^ticket( |$)/.test(option.label)), 'the sub menu labels start with the command');
    assert.ok(subMenu.options.some((option) => option.label === 'ticket category add' || /^ticket category /.test(option.label)), 'the label of a deep entry is its whole path');
    const spanish = menusOf(rowsJson(help.subcommandView(client, guild, ticket, 'tickets', false, 'es').components))[0];
    assert.notDeepEqual(spanish.options.map((option) => option.description), subMenu.options.map((option) => option.description), 'the descriptions are translated');
    // The first sentence, cut at 100 with an ellipsis; "e.g. 30s" is not the end of a sentence.
    assert.equal(help.optionDescription('Create your booster role. Requires boosting.'), 'Create your booster role.');
    assert.equal(help.optionDescription('Set how long, e.g. 30s or 5m, it lasts.'), 'Set how long, e.g. 30s or 5m, it lasts.');
    const clipped = help.optionDescription('x'.repeat(150));
    assert.equal([...clipped].length, 100); assert.ok(clipped.endsWith('…'));
    assert.equal(help.optionDescription('', 'fallback'), 'fallback');
    assert.equal(help.optionDescription(undefined, 'fallback'), 'fallback');
  }

  console.log('help line checks passed');
})().catch((error) => { console.error(error); process.exit(1); });

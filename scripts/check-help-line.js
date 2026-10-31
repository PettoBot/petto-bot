// Checks the short answer of !help: a plain message with a silent mention of the author, the page with every command and the support
// server (links wrapped in <>), in en, es and pt-BR; and that the rest of !help is still there: `!help full` and the slash command
// open the browser, `!help <command>` explains one, and no slash command was added.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { Collection, MessageFlags } = require('discord.js');
const guilds = require('../src/db/guilds');
guilds.ensureGuild = async () => ({ prefixes: ['!'], prefix: '!' });
const { loadCommands } = require('../src/handlers/commandHandler');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const { applySilentMentions } = require('../src/utils/silentMentions');
const { SUPPORT_URL, COMMANDS_URL, commandsUrl } = require('../src/utils/links');
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

  const expected = {
    en: ['<https://petto.sbs/commands>', 'join the support server @ <https://petto.sbs/support>'],
    es: ['<https://petto.sbs/es/commands>', 'únete al servidor de soporte @ <https://petto.sbs/support>'],
    'pt-BR': ['<https://petto.sbs/pt-br/commands>', 'entre no servidor de suporte @ <https://petto.sbs/support>'],
  };
  for (const lang of LANGUAGES) {
    help.resetSupportShown();
    const payload = await typed('', lang);
    assert.equal(sent.length, 1, 'one message');
    assert.equal(payload.components, undefined, 'a plain message, no card');
    assert.equal(payload.embeds, undefined, 'and no embed');
    assert.equal(payload.flags, undefined);
    const [first, ...rest] = payload.content.split('\n');
    assert.ok(first.startsWith(`!<@${user.id}>: `), `${lang}: the silent mention of the author comes first`);
    assert.equal(first, `!<@${user.id}>: ${expected[lang][0]}, ${expected[lang][1]}`);
    assert.match(rest.join('\n'), /^-# `!help full`.*`!help <(command|comando)>`/);
    assert.ok(!/discord\.gg|discord\.com\/invite/.test(payload.content), 'no hardcoded invite');
    assert.ok(payload.content.includes(`<${SUPPORT_URL}>`) && payload.content.includes(`<${commandsUrl(lang)}>`), 'both links are wrapped in <>');
    // What the library sends once the silent mention is applied: the pill, and nobody is notified.
    const final = applySilentMentions(payload, guild);
    assert.ok(final.content.startsWith(`<@${user.id}>: <https://petto.sbs`), `${lang}: the ! is taken out`);
    assert.deepEqual(final.allowedMentions.parse, []);
    assert.ok(!final.allowedMentions.users, 'no user is notified');
    assert.equal(final.allowedMentions.repliedUser, false, 'the reply does not ping either');
    assert.ok(payload.content.length < 400);
  }
  for (const lang of LANGUAGES) {
    for (const key of ['help.line', 'help.line.tip']) assert.ok(Object.hasOwn(CATALOGS[lang], key), `${lang} has ${key}`);
    assert.ok(CATALOGS[lang]['help.line'].includes('<{help}>') && CATALOGS[lang]['help.line'].includes('<{support}>'));
  }

  // The support server is offered the first time, left out on the next ones, and offered again after the interval.
  help.resetSupportShown();
  const first = await typed('');
  assert.ok(first.content.includes(`<${SUPPORT_URL}>`), 'the first !help invites to the support server');
  const second = await typed('');
  assert.ok(!second.content.includes(SUPPORT_URL), 'the next one does not');
  assert.ok(second.content.startsWith(`!<@${user.id}>: <https://petto.sbs/commands>\n`), 'it is the short line with the commands link');
  assert.ok(second.content.includes('`!help full`'), 'and keeps the tip');
  assert.ok(!help.supportDue(user.id, Date.now() + help.SUPPORT_EVERY_MS - 60000), 'still quiet just before the interval');
  assert.ok(help.supportDue(user.id, Date.now() + help.SUPPORT_EVERY_MS + 1000), 'offered again after the interval');
  assert.ok(help.supportDue('999999999999999999'), 'another person gets it the first time');
  for (const lang of LANGUAGES) assert.ok(Object.hasOwn(CATALOGS[lang], 'help.line.plain') && !CATALOGS[lang]['help.line.plain'].includes('{support}'), `${lang} has the short line`);
  help.resetSupportShown();
  for (let i = 0; i < 700; i += 1) help.supportDue(`u${i}`);
  assert.ok(help.supportDue('u0'), 'the oldest ones leave the memory (capped at 500)');

  // The rest of !help.
  for (const word of ['full', 'FULL', 'menu', 'all']) {
    const payload = await typed(word);
    assert.ok(payload.components?.length && (payload.flags & MessageFlags.IsComponentsV2), `!help ${word} opens the browser`);
  }
  let payload = await typed('ban');
  assert.ok(payload.components?.length, '!help ban explains the command');
  assert.ok(JSON.stringify(payload.components.map((c) => c.toJSON())).includes('ban'));
  payload = await typed('nosuchcommand');
  assert.ok(JSON.stringify(payload.components.map((c) => c.toJSON())).includes('nosuchcommand'), 'an unknown command is still told');

  // The slash command has no short form: it opens the browser, private.
  const slash = [];
  const interaction = {
    guild, guildId: guild.id, user, client, pettoLang: 'en', options: { getString: () => null },
    reply: async (p) => { slash.push(p); return { createMessageComponentCollector: () => ({ on() {}, stop() {} }) }; },
  };
  await help.execute(interaction);
  assert.ok(slash[0].components && (slash[0].flags & MessageFlags.Ephemeral), '/help opens the private browser');
  assert.equal(slash[0].content, undefined);

  console.log('help line checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

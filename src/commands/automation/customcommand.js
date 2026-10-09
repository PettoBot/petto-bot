const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const ccDb = require('../../db/customCommands');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { AttachmentBuilder } = require('discord.js');
const { run, PettoCodeError, closestName, MAX_SOURCE_LENGTH } = require('../../scripting');
const { TEMPLATES, byId } = require('../../scripting/templates');
const codeCommands = require('../../utils/codeCommands');
const { codeProblem, describeEffect, effectDetails, codeHintList, codeSummary, saveCodeCommand, setCommandTrigger, commandLimit, fullMessage, NAME_SHAPE, isRealCommand, prefixHint } = require('../../utils/codeCommandAdmin');
const { TRIGGER_TYPES, invalidateTriggers } = require('../../utils/codeTriggers');
const { register, sendPager } = require('../../utils/pager');

/** How big a command is, for the list: its code, its text or its embed template. */
function sizeNote(row) {
  if (row.code) return `${row.code.length} characters`;
  const parts = [row.response ? `${row.response.length} characters` : null, row.embed_template ? `embed \`${row.embed_template}\`` : null].filter(Boolean);
  return parts.join(' + ') || 'empty';
}

/** How a command is typed, for the list: `!req`, `.req` or the words that start it. */
function startsWith(row, serverPrefix) {
  if (!row.trigger_type || row.trigger_type === 'command') return `\`${serverPrefix}${row.name}\``;
  if (row.trigger_type === 'prefix') return `\`${row.trigger_text ?? ''}${row.name}\``;
  return `${row.trigger_type} \`${row.trigger_text ?? ''}\``;
}

register('customcommands', {
  async load(guild) {
    const rows = [...await ccDb.listCommands(guild.id)].sort((a, b) => a.name.localeCompare(b.name));
    const serverPrefix = (await ensureGuild(guild.id).catch(() => null))?.prefix || '!';
    const { limit } = await commandLimit(guild.id);
    return {
      title: `Custom commands (${rows.length}/${limit})`,
      subtitle: [`See one with \`${serverPrefix}customcommand info <name>\`.`],
      items: rows.map((row) => `\`${row.name}\` · ${row.code ? 'code' : 'text'} · ${startsWith(row, serverPrefix)} · ${sizeNote(row)}`),
      empty: `No custom commands yet. Create one with \`${serverPrefix}customcommand add\` or \`${serverPrefix}customcommand template\`.`,
    };
  },
});

/** ` Did you mean \`req\`?` when a command with a name close to `name` exists, or nothing. */
async function didYouMean(guildId, name) {
  const rows = await ccDb.listCommands(guildId).catch(() => []);
  const meant = closestName(name, rows.map((row) => row.name));
  return meant ? ` Did you mean \`${meant}\`?` : '';
}


module.exports = {
  data: new SlashCommandBuilder()
    .setName('customcommand')
    .setDescription('Create your own commands that reply with a saved message.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a custom command.')
        .addStringOption((o) => o.setName('name').setDescription("The command's name (no prefix)").setRequired(true))
        .addStringOption((o) => o.setName('response').setDescription('Reply text/flags. Supports {args}, {arg1}, {user}, etc. Optional with embed_template.').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('A saved /embed template to send instead of plain text').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit an existing custom command.')
        .addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true))
        .addStringOption((o) => o.setName('response').setDescription('New response text/flags; omit to keep the current response').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Saved /embed template; use clear to remove it').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a custom command.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List every custom command.'))
    .addSubcommand((s) => s.setName('code').setDescription('Create or change a command written in code (Petto Code). Write the code after the name.').addStringOption((o) => o.setName('name').setDescription("The command's name (no prefix)").setRequired(true)).addStringOption((o) => o.setName('code').setDescription('The code, after the name, inside a code block if it has several lines').setRequired(false)))
    .addSubcommand((s) => s.setName('rename').setDescription('Change the name of a command, keeping its code and its trigger.').addStringOption((o) => o.setName('name').setDescription('The current name').setRequired(true)).addStringOption((o) => o.setName('new_name').setDescription('The new name').setRequired(true)))
    .addSubcommand((s) => s.setName('trigger').setDescription('What starts a command: its own prefix, the start of a message, a whole message or words inside.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)).addStringOption((o) => o.setName('type').setDescription(`One of: ${TRIGGER_TYPES.join(', ')}`).setRequired(false)).addStringOption((o) => o.setName('text').setDescription('The prefix or the words, for every type except command').setRequired(false)))
    .addSubcommand((s) => s.setName('info').setDescription('What a command is: its trigger, its size and what its code uses.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('codeshow').setDescription('Show the code of a command.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('codetest').setDescription('Run some code to see what it would do, without sending or changing anything.').addStringOption((o) => o.setName('code').setDescription('The code, inside a code block if it has several lines').setRequired(false)))
    .addSubcommand((s) => s.setName('template').setDescription('List the ready-made commands in code, or install one.').addStringOption((o) => o.setName('id').setDescription('The template to install; leave empty to list them').setRequired(false)).addStringOption((o) => o.setName('name').setDescription('The name for the command; leave empty to use the suggested one').setRequired(false)))
    .addSubcommand((s) => s.setName('export').setDescription('Get a share code of a command in code, to share it or import it in another server.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('import').setDescription('Create a command in code from a share code (it starts with pc1.).').addStringOption((o) => o.setName('share').setDescription('The share code').setRequired(true)).addStringOption((o) => o.setName('name').setDescription('The name for the command; leave empty to use the one in the code').setRequired(false)))
    .addSubcommand((s) => s.setName('vars').setDescription('Show custom-command arguments, variables, and reply flags.'))
    .addSubcommand((s) => s.setName('show').setDescription('Show a custom command without triggering it.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true))),
  aliases: ['cc'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction, false);
    if (sub === 'edit') return addCmd(interaction, true);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    if (sub === 'vars') return varsCmd(interaction);
    if (sub === 'trigger') return triggerCmd(interaction);
    if (sub === 'rename') return renameCmd(interaction);
    if (sub === 'info') return infoCmd(interaction);
    if (['code', 'codeshow', 'codetest', 'template', 'export', 'import'].includes(sub)) return codeCmd(interaction, sub);
    return showCmd(interaction);
  },
};

async function addCmd(interaction, isEdit) {
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const responseInput = interaction.options.getString('response');
  const embedInput = interaction.options.getString('embed_template');
  const requestedEmbedTemplate = embedInput?.trim().toLowerCase() === 'clear' ? null : embedInput;

  if (interaction.client.commands.has(name) || interaction.client.commandAliases.has(name) || interaction.client.commandRoutes?.has(name)) {
    await interaction.reply({ content: `\`${name}\` is already a real command — pick a different name.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  let existing = null;
  if (isEdit) {
    existing = await ccDb.getCommand(interaction.guild.id, name);
    if (!existing) {
      await interaction.editReply({ components: [textCard(`\`${name}\` doesn't exist.`, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    if (responseInput == null && embedInput == null) {
      await interaction.editReply({ components: [textCard('Provide a new response or embed_template to edit.', COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  } else {
    existing = await ccDb.getCommand(interaction.guild.id, name);
    if (existing) {
      await interaction.editReply({ components: [textCard(`\`${name}\` already exists — use \`customcommand edit\` instead.`, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const current = await ccDb.listCommands(interaction.guild.id);
    const allowed = await commandLimit(interaction.guild.id);
    if (current.length >= allowed.limit) {
      await interaction.editReply({ components: [textCard(fullMessage(allowed), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  const response = isEdit ? (responseInput ?? existing.response) : responseInput;
  const embedTemplate = isEdit
    ? (embedInput == null ? existing.embed_template : requestedEmbedTemplate)
    : requestedEmbedTemplate;

  if (!response && !embedTemplate) {
    await interaction.editReply({ components: [textCard('Add a response, an embed_template, or both.', COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate);
    if (!template) {
      await interaction.editReply({ components: [textCard(`Embed template \`${embedTemplate}\` doesn't exist.`, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  await ccDb.upsertCommand(interaction.guild.id, name, { response, embedTemplate });
  const prefix = (await ensureGuild(interaction.guild.id).catch(() => null))?.prefix || '!';
  const hint = isEdit ? '' : ` Try \`${prefix}${name} your request here\`; use \`${prefix}customcommand vars\` for variables.`;
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  \`${name}\` ${isEdit ? 'updated' : 'created'}.${hint}`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function triggerCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!codeCommands.canWriteCode()) {
    return reply(interaction, `${EMOJI.DENY}  Triggers of your own are turned off for now.`, COLORS.RED);
  }
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) return reply(interaction, `\`${name}\` does not exist.`, COLORS.RED);
  const serverPrefix = (await ensureGuild(interaction.guild.id).catch(() => null))?.prefix || '!';
  const current = describeTrigger(row, name, serverPrefix);
  const type = (interaction.options.getString('type') ?? '').trim().toLowerCase();
  if (!type) {
    return reply(interaction, `\`${name}\` starts with ${current}.\n\nChange it:\n\`\`\`\n${serverPrefix}customcommand trigger ${name} prefix .\n${serverPrefix}customcommand trigger ${name} startswith hello\n${serverPrefix}customcommand trigger ${name} command\n\`\`\`\n-# Types: ${TRIGGER_TYPES.join(', ')}. \`prefix\` is a prefix of its own (up to 5 characters), \`command\` goes back to the prefix of the server.`);
  }
  const text = raw3(interaction) ?? interaction.options.getString('text');
  if (type === 'prefix' && !String(text ?? '').trim()) {
    return reply(interaction, `Write the prefix after \`prefix\`, for example \`${serverPrefix}customcommand trigger ${name} prefix .\`, so \`.${name}\` runs it.`, COLORS.RED);
  }
  if (type === 'prefix' && String(text).trim() === serverPrefix) {
    return reply(interaction, `\`${serverPrefix}\` is the prefix of the server already. Use \`${serverPrefix}customcommand trigger ${name} command\` to start with it, or pick another prefix.`, COLORS.RED);
  }
  if (type !== 'command' && type === row.trigger_type && String(text ?? '').trim() === String(row.trigger_text ?? '')) {
    return reply(interaction, `\`${name}\` already starts with ${current}. Nothing changed.`);
  }
  if (type === 'command' && (!row.trigger_type || row.trigger_type === 'command')) {
    return reply(interaction, `\`${name}\` already starts with the prefix of the server (\`${serverPrefix}${name}\`). Nothing changed.`);
  }
  const changed = await setCommandTrigger({ guild: interaction.guild, client: interaction.client, name, type, text });
  if (!changed.ok) return reply(interaction, changed.message, COLORS.RED);
  const how = type === 'command' ? `the prefix of the server again (\`${serverPrefix}${name}\`)` : type === 'prefix' ? `its own prefix: \`${changed.text}${name}\`` : `${type}: \`${changed.text}\``;
  const before = row.trigger_type && row.trigger_type !== 'command' ? ` It was ${current}.` : '';
  return reply(interaction, `${EMOJI.APPROVE}  \`${name}\` now starts with ${how}.${before}`, COLORS.GREEN);
}

/** How a command starts, as words for a sentence. */
function describeTrigger(row, name, serverPrefix) {
  if (!row.trigger_type || row.trigger_type === 'command') return `the prefix of the server (\`${serverPrefix}${name}\`)`;
  if (row.trigger_type === 'prefix') return `its own prefix \`${row.trigger_text}\` (\`${row.trigger_text}${name}\`)`;
  return `${row.trigger_type} \`${row.trigger_text}\``;
}

/** The text of a trigger as it was typed, so spaces inside it are kept: the words after the type. */
function raw3(interaction) {
  return codeCommands.rawAfter(interaction.rawMessage?.content ?? '', 2) || null;
}

/** `!cc rename req1 req`: the same command under another name. The code, the trigger and the data stay; the messages it sent before keep the old name. */
async function renameCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const oldName = ccDb.normalizeName(interaction.options.getString('name', true));
  const newName = ccDb.normalizeName(interaction.options.getString('new_name', true));
  const fail = (text) => reply(interaction, text, COLORS.RED);
  if (!NAME_SHAPE.test(newName)) return fail('A name has 1 to 32 letters, numbers, - or _.');
  if (oldName === newName) return fail('That is the name it has already.');
  const row = await ccDb.getCommand(interaction.guild.id, oldName);
  if (!row) return fail(`\`${oldName}\` does not exist.`);
  if (isRealCommand(interaction.client, newName)) return fail(`\`${newName}\` is already a real command, pick a different name.`);
  if (await ccDb.getCommand(interaction.guild.id, newName)) return fail(`\`${newName}\` already exists. Remove it first with \`customcommand remove ${newName}\`.`);
  try {
    await ccDb.renameCommand(interaction.guild.id, oldName, newName);
  } catch (err) {
    if (err?.code === '23505') return fail(`\`${newName}\` already exists.`);
    throw err;
  }
  invalidateTriggers(interaction.guild.id);
  const prefix = (await ensureGuild(interaction.guild.id).catch(() => null))?.prefix || '!';
  const own = row.trigger_type === 'prefix' && row.trigger_text ? ` It still starts with its own prefix: \`${row.trigger_text}${newName}\`.` : '';
  return reply(interaction, `${EMOJI.APPROVE}  \`${oldName}\` is now \`${newName}\`. Try \`${prefix}${newName}\`.${own}\n-# Buttons and reactions on messages it sent before still point to the old name.`, COLORS.GREEN);
}

async function removeCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await ccDb.removeCommand(interaction.guild.id, name);
  invalidateTriggers(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed.` : "That custom command doesn't exist.", removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

/** The commands of the server a page at a time, sorted by name: what each one is, how it starts and how big it is. */
async function listCmd(interaction) {
  return sendPager(interaction, 'customcommands');
}

/** `!cc info req`: what a command is, how it starts, how big it is and what its code uses. */
async function infoCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) return reply(interaction, `\`${name}\` does not exist.${await didYouMean(interaction.guild.id, name)}`, COLORS.RED);
  const serverPrefix = (await ensureGuild(interaction.guild.id).catch(() => null))?.prefix || '!';
  const lines = [`### \`${row.name}\``, `**Kind:** ${row.code ? 'code (Petto Code)' : 'text'}`, `**Starts with:** ${describeTrigger(row, row.name, serverPrefix)}`];
  if (!row.code) {
    if (row.response) lines.push(`**Size:** ${row.response.length} characters`);
    if (row.embed_template) lines.push(`**Embed template:** \`${row.embed_template}\``);
    lines.push(`-# See it with \`${serverPrefix}customcommand show ${row.name}\`.`);
    return reply(interaction, lines.join('\n'));
  }
  lines.push(`**Size:** ${row.code.length} of ${MAX_SOURCE_LENGTH} characters`);
  const summary = codeSummary(row.code);
  if (summary) {
    const uses = [
      summary.storedData && 'stored data', summary.buttons && 'buttons', summary.menus && 'menus', summary.reactions && 'reactions',
      summary.forms && 'forms', summary.roles && 'roles', summary.directMessages && 'direct messages', summary.lookups && 'members, roles or channels of the server',
    ].filter(Boolean);
    lines.push(`**Uses:** ${uses.length ? uses.join(', ') : 'nothing special, it only answers'}`);
    lines.push(`**Functions:** ${summary.functions.length ? clipText(summary.functions.map((fn) => `\`${fn}\``).join(', '), 1200) : 'none'}`);
  } else {
    lines.push(`${EMOJI.WARNING}  ${codeProblem(row.code) ?? 'The code has a mistake.'}`);
  }
  if (row.created_by) lines.push(`**Written by:** <@${row.created_by}>`);
  const hints = codeHintList(row.code);
  if (hints.length) lines.push('', ...hints.slice(0, 5).map((hint) => `-# Hint: ${hint.text}`));
  lines.push(`-# See the code with \`${serverPrefix}customcommand codeshow ${row.name}\`, try it with \`${serverPrefix}customcommand codetest\`.`);
  return reply(interaction, lines.join('\n'));
}

async function varsCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const text = [
    '### Custom command variables',
    '`{args}` / `{arguments}` — everything typed after the command.',
    '`{arg1}` … `{arg10}` — individual arguments; quoted phrases stay together.',
    '`{args_from:2}` — argument 2 through the end.',
    '`{arg_count}` — number of arguments.',
    '`{command_name}` — custom command name.',
    '`{prefix}` — prefix used to invoke the command.',
    'Every normal `/embed` variable such as `{user}` and `{server_name}` also works.',
    '',
    '### Reply flags',
    "`{reactreply:💛}` — react to Petto's reply. Repeat it for multiple reactions.",
    '',
    '**Example:** `!req christmas gift banners` + an embed containing `Request: {args}`.',
    'If a response/embed uses an argument variable and no text is supplied, Petto asks the user for input instead of sending an empty card.',
  ].join('\n');
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}

async function showCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) {
    await interaction.editReply({ components: [textCard("That custom command doesn't exist.", COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const text = `**\`${row.name}\`**\n${row.embed_template ? `Embed template: \`${row.embed_template}\`` : ''}${row.response ? `\nResponse: ${row.response}` : ''}`;
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}

// ── Commands written in code (Petto Code) ───────────────────────────────────

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
/** A long text goes in a file, sent as a normal message because a card cannot hold files. */
async function sendAsFile(interaction, content, fileName, text) {
  await interaction.channel.send({ content, files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: fileName })], allowedMentions: { parse: [] } });
  return reply(interaction, `${EMOJI.APPROVE}  Sent as a file below.`, COLORS.GREEN);
}
const clipText = (text, max = 1500) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** When the code says it is used with a prefix of its own (`.req`) and the command does not have it, tell how to give it. */
async function missingPrefixWarning(interaction, name, code, serverPrefix) {
  const hint = prefixHint(name, code);
  if (!hint) return '';
  const row = await ccDb.getCommand(interaction.guild.id, name).catch(() => null);
  if (row?.trigger_type === 'prefix' && row.trigger_text === hint.prefix) return '';
  const rename = hint.word !== name ? ` (it would be \`${hint.prefix}${name}\`; to call it \`${hint.prefix}${hint.word}\`, first \`${serverPrefix}customcommand rename ${name} ${hint.word}\`)` : '';
  return `\n\n${EMOJI.WARNING}  The code says it is used as \`${hint.prefix}${hint.word}\`, but it starts with the prefix of the server, so only \`${serverPrefix}${name}\` runs it.\nGive it that prefix: \`${serverPrefix}customcommand trigger ${name} prefix ${hint.prefix}\`${rename}.`;
}

async function saveCode(interaction, name, code, verb) {
  const saved = await saveCodeCommand({ guild: interaction.guild, client: interaction.client, userId: interaction.user.id, name, code });
  if (!saved.ok) return reply(interaction, saved.message, COLORS.RED);
  // The commands are typed with the prefix of the server (`p!req1`), so the message says that one and not always `!`.
  const prefix = (await ensureGuild(interaction.guild.id).catch(() => null))?.prefix || '!';
  const warning = await missingPrefixWarning(interaction, name, code, prefix);
  return reply(interaction, `${EMOJI.APPROVE}  \`${name}\` ${saved.created ? verb : 'updated'}. Try \`${prefix}${name}\`. See it again with \`${prefix}customcommand codeshow ${name}\`.${warning}`, warning ? COLORS.YELLOW : COLORS.GREEN);
}

async function codeCmd(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!codeCommands.canWriteCode()) {
    return reply(interaction, `${EMOJI.DENY}  Custom commands in code are turned off for now.`, COLORS.RED);
  }
  const raw = interaction.rawMessage?.content ?? '';

  if (sub === 'template') {
    const id = interaction.options.getString('id');
    if (!id) {
      const lines = TEMPLATES.map((template) => `\`${template.id}\` · **${template.name}**: ${template.description}`);
      return reply(interaction, `### Commands in code you can install\n${lines.join('\n')}\n\nInstall one with \`!customcommand template <id> [name]\`. You can change it later with \`!customcommand code\`.`);
    }
    const template = byId(id);
    if (!template) return reply(interaction, `There is no template called \`${id}\`. See them with \`!customcommand template\`.`, COLORS.RED);
    const name = ccDb.normalizeName(interaction.options.getString('name') ?? template.suggestedName);
    return saveCode(interaction, name, template.code, 'created from the template');
  }

  if (sub === 'code') {
    const name = ccDb.normalizeName(interaction.options.getString('name', true));
    const code = codeCommands.extractCode(codeCommands.rawAfter(raw, 1));
    return saveCode(interaction, name, code, 'created');
  }

  if (sub === 'codetest') {
    // A code block can have arguments after it: `!cc codetest ```code``` a b` tries it as if `a b` were typed.
    const { code, args } = codeCommands.splitCodeArgs(codeCommands.rawAfter(raw, 0));
    const problem = codeProblem(code);
    if (problem) return reply(interaction, problem, COLORS.RED);
    const hints = codeHintList(code);
    try {
      const data = codeCommands.buildData(interaction.rawMessage, 'test', args, '!');
      const result = await run(code, data, { store: codeCommands.memoryStore(), lookup: codeCommands.lookupFor(interaction.guild) });
      const output = result.output.trim();
      const actions = result.effects.map((effect) => [`• ${describeEffect(effect)}`, ...effectDetails(effect).map((line) => `  ↳ ${line}`)].join('\n')).join('\n');
      return reply(interaction, [
        `### Test run (nothing was sent or changed)${args ? `\n-# With the arguments: ${clipText(args, 200)}` : ''}`,
        `**It would print:** ${output ? `\n${clipText(output)}` : '_nothing_'}`,
        `**It would do:** ${actions ? `\n${clipText(actions, 1600)}` : '_nothing else_'}`,
        ...hints.slice(0, 5).map((hint) => `-# Hint: ${hint.text}`),
        `-# ${result.steps} steps, ${result.millis} ms`,
      ].join('\n'));
    } catch (error) {
      if (error instanceof PettoCodeError) {
        // The mistake already says the name it meant, so only the other hints are added.
        const more = hints.filter((hint) => !(hint.kind === 'function' && String(error.detail).includes(`"${hint.name}"`)));
        return reply(interaction, [`The code stopped: ${error.detail}${error.line ? ` (line ${error.line}, column ${error.column})` : ''}`, ...more.slice(0, 5).map((hint) => `-# Hint: ${hint.text}`)].join('\n'), COLORS.RED);
      }
      throw error;
    }
  }

  if (sub === 'import') {
    let shared;
    try { shared = codeCommands.decodeShare(interaction.options.getString('share', true)); } catch (error) { return reply(interaction, error.message, COLORS.RED); }
    const name = ccDb.normalizeName(interaction.options.getString('name') ?? shared.name);
    if (!name) return reply(interaction, 'That share code has no name, so give one: `!customcommand import <code> <name>`.', COLORS.RED);
    return saveCode(interaction, name, shared.code, 'imported');
  }

  // codeshow and export
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row?.code) return reply(interaction, `\`${name}\` does not exist or it is not written in code.${row ? '' : await didYouMean(interaction.guild.id, name)}`, COLORS.RED);
  if (sub === 'export') {
    const share = codeCommands.encodeShare({ name: row.name, code: row.code });
    if (share.length > 1800) return sendAsFile(interaction, `The share code of \`${row.name}\` is long, so it is in this file.`, `${row.name}.pc1.txt`, share);
    return reply(interaction, `Share code of \`${row.name}\`. Import it with \`!customcommand import <code>\`:\n\`\`\`\n${share}\n\`\`\``);
  }
  if (row.code.length > 1700) return sendAsFile(interaction, `The code of \`${row.name}\` is long, so it is in this file.`, `${row.name}.txt`, row.code);
  // handlebars is the language Discord colors `{{ }}` best with: the actions stand out from the text around them.
  return reply(interaction, `**\`${row.name}\`**\n\`\`\`handlebars\n${row.code}\n\`\`\``);
}

module.exports.missingPrefixWarning = missingPrefixWarning;

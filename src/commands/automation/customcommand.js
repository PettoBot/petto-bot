const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const ccDb = require('../../db/customCommands');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { AttachmentBuilder } = require('discord.js');
const { run, PettoCodeError } = require('../../scripting');
const { TEMPLATES, byId } = require('../../scripting/templates');
const codeCommands = require('../../utils/codeCommands');
const { codeProblem, describeEffect, saveCodeCommand, setCommandTrigger, commandLimit, fullMessage } = require('../../utils/codeCommandAdmin');
const { TRIGGER_TYPES, invalidateTriggers } = require('../../utils/codeTriggers');


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
    .addSubcommand((s) => s.setName('trigger').setDescription('What starts a command: its own prefix, the start of a message, a whole message or words inside.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)).addStringOption((o) => o.setName('type').setDescription(`One of: ${TRIGGER_TYPES.join(', ')}`).setRequired(false)).addStringOption((o) => o.setName('text').setDescription('The prefix or the words, for every type except command').setRequired(false)))
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
  const hint = isEdit ? '' : ` Try \`!${name} your request here\`; use \`!customcommand vars\` for variables.`;
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  \`${name}\` ${isEdit ? 'updated' : 'created'}.${hint}`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

/** How a command starts, for the list: nothing for the prefix of Petto. */
function triggerNote(row) {
  if (!row.trigger_type || row.trigger_type === 'command') return '';
  const text = row.trigger_text ?? '';
  return ` [${row.trigger_type === 'prefix' ? `${text}${row.name}` : `${row.trigger_type}: ${text}`}]`;
}

async function triggerCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!codeCommands.canWriteCode()) {
    return reply(interaction, `${EMOJI.DENY}  Triggers of your own are turned off for now.`, COLORS.RED);
  }
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) return reply(interaction, `\`${name}\` does not exist.`, COLORS.RED);
  const type = (interaction.options.getString('type') ?? '').trim().toLowerCase();
  if (!type) {
    return reply(interaction, `\`${name}\` starts with ${row.trigger_type && row.trigger_type !== 'command' ? `${row.trigger_type === 'prefix' ? `its own prefix \`${row.trigger_text}\`, so \`${row.trigger_text}${name}\`` : `${row.trigger_type} \`${row.trigger_text}\``}` : 'the prefix of Petto'}.\n\nChange it with \`!customcommand trigger ${name} <${TRIGGER_TYPES.join('|')}> [text]\`.`);
  }
  const changed = await setCommandTrigger({ guild: interaction.guild, client: interaction.client, name, type, text: raw3(interaction) ?? interaction.options.getString('text') });
  if (!changed.ok) return reply(interaction, changed.message, COLORS.RED);
  const how = type === 'command' ? 'the prefix of Petto again' : type === 'prefix' ? `its own prefix: \`${changed.text}${name}\`` : `${type}: \`${changed.text}\``;
  return reply(interaction, `${EMOJI.APPROVE}  \`${name}\` now starts with ${how}.`, COLORS.GREEN);
}

/** The text of a trigger as it was typed, so spaces inside it are kept: the words after the type. */
function raw3(interaction) {
  return codeCommands.rawAfter(interaction.rawMessage?.content ?? '', 2) || null;
}

async function removeCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await ccDb.removeCommand(interaction.guild.id, name);
  invalidateTriggers(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed.` : "That custom command doesn't exist.", removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await ccDb.listCommands(interaction.guild.id);
  const text = rows.length ? rows.map((r) => `\`${r.name}\`${r.code ? ' (code)' : ''}${triggerNote(r)}`).join(', ') : 'No custom commands yet.';
  const { limit } = await commandLimit(interaction.guild.id);
  await interaction.editReply({ components: [textCard(`**Custom commands (${rows.length}/${limit}):**\n${text}`, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
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

async function saveCode(interaction, name, code, verb) {
  const saved = await saveCodeCommand({ guild: interaction.guild, client: interaction.client, userId: interaction.user.id, name, code });
  if (!saved.ok) return reply(interaction, saved.message, COLORS.RED);
  return reply(interaction, `${EMOJI.APPROVE}  \`${name}\` ${saved.created ? verb : 'updated'}. Try \`!${name}\`. See it again with \`!customcommand codeshow ${name}\`.`, COLORS.GREEN);
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
    const code = codeCommands.extractCode(codeCommands.rawAfter(raw, 0));
    const problem = codeProblem(code);
    if (problem) return reply(interaction, problem, COLORS.RED);
    try {
      const data = codeCommands.buildData(interaction.rawMessage, 'test', '', '!');
      const result = await run(code, data, { store: codeCommands.memoryStore() });
      const output = result.output.trim();
      const actions = result.effects.map((effect) => `• ${describeEffect(effect)}`).join('\n');
      return reply(interaction, [
        '### Test run (nothing was sent or changed)',
        `**It would print:** ${output ? `\n${clipText(output)}` : '_nothing_'}`,
        `**It would do:** ${actions ? `\n${clipText(actions)}` : '_nothing else_'}`,
        `-# ${result.steps} steps, ${result.millis} ms`,
      ].join('\n'));
    } catch (error) {
      if (error instanceof PettoCodeError) return reply(interaction, `The code stopped: ${error.detail}${error.line ? ` (line ${error.line}, column ${error.column})` : ''}`, COLORS.RED);
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
  if (!row?.code) return reply(interaction, `\`${name}\` does not exist or it is not written in code.`, COLORS.RED);
  if (sub === 'export') {
    const share = codeCommands.encodeShare({ name: row.name, code: row.code });
    if (share.length > 1800) return sendAsFile(interaction, `The share code of \`${row.name}\` is long, so it is in this file.`, `${row.name}.pc1.txt`, share);
    return reply(interaction, `Share code of \`${row.name}\`. Import it with \`!customcommand import <code>\`:\n\`\`\`\n${share}\n\`\`\``);
  }
  if (row.code.length > 1700) return sendAsFile(interaction, `The code of \`${row.name}\` is long, so it is in this file.`, `${row.name}.txt`, row.code);
  return reply(interaction, `**\`${row.name}\`**\n\`\`\`\n${row.code}\n\`\`\``);
}

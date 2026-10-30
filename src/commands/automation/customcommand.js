const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guildPrefixes = require('../../utils/guildPrefixes');
const { ensureGuild } = require('../../db/guilds');
const ccDb = require('../../db/customCommands');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { AttachmentBuilder } = require('discord.js');
const { run, say, PettoCodeError, closestName, MAX_SOURCE_LENGTH } = require('../../scripting');
const { TEMPLATES, byId, templateIn, templateCode } = require('../../scripting/templates');
const codeCommands = require('../../utils/codeCommands');
const { codeProblem, describeEffect, effectDetails, codeHintList, codeSummary, saveCodeCommand, setCommandTrigger, commandLimit, fullMessage, NAME_SHAPE, isRealCommand, prefixHint } = require('../../utils/codeCommandAdmin');
const { TRIGGER_TYPES, invalidateTriggers } = require('../../utils/codeTriggers');
const { register, sendPager } = require('../../utils/pager');
const { t, tn, languageOf, currentLanguage } = require('../../i18n');

/** How big a command is, for the list: its code, its text or its embed template. */
function sizeNote(row, lang) {
  const characters = (count) => tn(lang, 'customcommands.list.characters', count, { count });
  if (row.code) return characters(row.code.length);
  const parts = [row.response ? characters(row.response.length) : null, row.embed_template ? t(lang, 'customcommands.list.embed', { name: row.embed_template }) : null].filter(Boolean);
  return parts.join(' + ') || t(lang, 'customcommands.list.empty');
}

/** How a command is typed, for the list: `!req`, `.req` or the words that start it. */
function startsWith(row, serverPrefix) {
  if (!row.trigger_type || row.trigger_type === 'command') return `\`${serverPrefix}${row.name}\``;
  if (row.trigger_type === 'prefix') return `\`${row.trigger_text ?? ''}${row.name}\``;
  return `${row.trigger_type} \`${row.trigger_text ?? ''}\``;
}

register('customcommands', {
  async load(guild, { lang }) {
    const rows = [...await ccDb.listCommands(guild.id)].sort((a, b) => a.name.localeCompare(b.name));
    const serverPrefix = guildPrefixes.primaryPrefix(await ensureGuild(guild.id).catch(() => null));
    const { limit } = await commandLimit(guild.id);
    return {
      title: t(lang, 'customcommands.list.title', { count: rows.length, limit }),
      subtitle: [t(lang, 'customcommands.list.subtitle', { prefix: serverPrefix })],
      items: rows.map((row) => `\`${row.name}\` · ${t(lang, row.code ? 'customcommands.kind.code' : 'customcommands.kind.text')} · ${startsWith(row, serverPrefix)} · ${sizeNote(row, lang)}`),
      empty: t(lang, 'customcommands.list.none', { prefix: serverPrefix }),
    };
  },
});

/** ` Did you mean \`req\`?` when a command with a name close to `name` exists, or nothing. */
async function didYouMean(guildId, name, lang) {
  const rows = await ccDb.listCommands(guildId).catch(() => []);
  const meant = closestName(name, rows.map((row) => row.name));
  return meant ? ` ${t(lang, 'customcommands.didYouMean', { name: meant })}` : '';
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
    // i18n-ignore: builder description, translated in the cmd.automation catalog
    .addSubcommand((s) => s.setName('trigger').setDescription('What starts a command: its own prefix, the start of a message, a whole message or words inside.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)).addStringOption((o) => o.setName('type').setDescription(`One of: ${TRIGGER_TYPES.join(', ')}`).setRequired(false)).addStringOption((o) => o.setName('text').setDescription('The prefix or the words, for every type except command').setRequired(false)))
    .addSubcommand((s) => s.setName('info').setDescription('What a command is: its trigger, its size and what its code uses.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('logs').setDescription('The last problems of the commands in code: mistakes, crashes and actions not done.').addStringOption((o) => o.setName('name').setDescription('Only the problems of this command; leave empty for all').setRequired(false)))
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
    if (sub === 'logs') return logsCmd(interaction);
    if (['code', 'codeshow', 'codetest', 'template', 'export', 'import'].includes(sub)) return codeCmd(interaction, sub);
    return showCmd(interaction);
  },
};

async function addCmd(interaction, isEdit) {
  const lang = await languageOf(interaction);
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const responseInput = interaction.options.getString('response');
  const embedInput = interaction.options.getString('embed_template');
  const requestedEmbedTemplate = embedInput?.trim().toLowerCase() === 'clear' ? null : embedInput;

  if (interaction.client.commands.has(name) || interaction.client.commandAliases.has(name) || (interaction.client.commandRoutes?.has(name) && !interaction.client.commandRoutes.get(name).short)) {
    await interaction.reply({ content: t(lang, 'customcommands.add.realCommand', { name }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  let existing = null;
  if (isEdit) {
    existing = await ccDb.getCommand(interaction.guild.id, name);
    if (!existing) {
      await interaction.editReply({ components: [textCard(t(lang, 'customcommands.add.missing', { name }), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    if (responseInput == null && embedInput == null) {
      await interaction.editReply({ components: [textCard(t(lang, 'customcommands.add.needChange'), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  } else {
    existing = await ccDb.getCommand(interaction.guild.id, name);
    if (existing) {
      await interaction.editReply({ components: [textCard(t(lang, 'customcommands.add.exists', { name }), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const current = await ccDb.listCommands(interaction.guild.id);
    const allowed = await commandLimit(interaction.guild.id);
    if (current.length >= allowed.limit) {
      await interaction.editReply({ components: [textCard(fullMessage(allowed, lang), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  const response = isEdit ? (responseInput ?? existing.response) : responseInput;
  const embedTemplate = isEdit
    ? (embedInput == null ? existing.embed_template : requestedEmbedTemplate)
    : requestedEmbedTemplate;

  if (!response && !embedTemplate) {
    await interaction.editReply({ components: [textCard(t(lang, 'customcommands.add.needResponse'), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate);
    if (!template) {
      await interaction.editReply({ components: [textCard(t(lang, 'customcommands.add.templateMissing', { name: embedTemplate }), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  await ccDb.upsertCommand(interaction.guild.id, name, { response, embedTemplate });
  const prefix = guildPrefixes.primaryPrefix(await ensureGuild(interaction.guild.id).catch(() => null));
  const done = t(lang, isEdit ? 'customcommands.add.updated' : 'customcommands.add.created', { emoji: EMOJI.APPROVE, name, prefix });
  await interaction.editReply({ components: [textCard(done, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function triggerCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!codeCommands.canWriteCode()) {
    return reply(interaction, t(lang, 'customcommands.trigger.off', { emoji: EMOJI.DENY }), COLORS.RED);
  }
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) return reply(interaction, t(lang, 'customcommands.notExist', { name }), COLORS.RED);
  const guildRow = await ensureGuild(interaction.guild.id).catch(() => null);
  const serverPrefix = guildPrefixes.primaryPrefix(guildRow);
  const serverPrefixes = guildPrefixes.prefixesOf(guildRow);
  const current = describeTrigger(row, name, serverPrefix, lang);
  const type = (interaction.options.getString('type') ?? '').trim().toLowerCase();
  if (!type) {
    return reply(interaction, t(lang, 'customcommands.trigger.current', { name, current, prefix: serverPrefix, types: TRIGGER_TYPES.join(', ') }));
  }
  const text = raw3(interaction) ?? interaction.options.getString('text');
  if (type === 'prefix' && !String(text ?? '').trim()) {
    return reply(interaction, t(lang, 'customcommands.trigger.writePrefix', { name, prefix: serverPrefix }), COLORS.RED);
  }
  const sameAsServer = type === 'prefix' ? serverPrefixes.find((p) => p.toLocaleLowerCase() === String(text).trim().toLocaleLowerCase()) : null;
  if (sameAsServer) {
    return reply(interaction, t(lang, 'customcommands.trigger.serverPrefix', { name, prefix: sameAsServer }), COLORS.RED);
  }
  if (type !== 'command' && type === row.trigger_type && String(text ?? '').trim() === String(row.trigger_text ?? '')) {
    return reply(interaction, t(lang, 'customcommands.trigger.already', { name, current }));
  }
  if (type === 'command' && (!row.trigger_type || row.trigger_type === 'command')) {
    return reply(interaction, t(lang, 'customcommands.trigger.alreadyServer', { name, prefix: serverPrefix }));
  }
  const changed = await setCommandTrigger({ guild: interaction.guild, client: interaction.client, name, type, text, lang });
  if (!changed.ok) return reply(interaction, changed.message, COLORS.RED);
  const before = row.trigger_type && row.trigger_type !== 'command' ? ` ${t(lang, 'customcommands.trigger.before', { current })}` : '';
  const nowKey = type === 'command' ? 'customcommands.trigger.nowServer' : type === 'prefix' ? 'customcommands.trigger.nowPrefix' : 'customcommands.trigger.nowOther';
  return reply(interaction, `${t(lang, nowKey, { emoji: EMOJI.APPROVE, name, prefix: serverPrefix, type, text: changed.text })}${before}`, COLORS.GREEN);
}

/** How a command starts, as words for a sentence. */
function describeTrigger(row, name, serverPrefix, lang) {
  if (!row.trigger_type || row.trigger_type === 'command') return t(lang, 'customcommands.trigger.describeServer', { prefix: serverPrefix, name });
  if (row.trigger_type === 'prefix') return t(lang, 'customcommands.trigger.describePrefix', { own: row.trigger_text, name });
  return `${row.trigger_type} \`${row.trigger_text}\``;
}

/** The text of a trigger as it was typed, so spaces inside it are kept: the words after the type. */
function raw3(interaction) {
  return codeCommands.rawAfter(interaction.rawMessage?.content ?? '', 2) || null;
}

/** `!cc rename req1 req`: the same command under another name. The code, the trigger and the data stay; the messages it sent before keep the old name. */
async function renameCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const oldName = ccDb.normalizeName(interaction.options.getString('name', true));
  const newName = ccDb.normalizeName(interaction.options.getString('new_name', true));
  const fail = (text) => reply(interaction, text, COLORS.RED);
  if (!NAME_SHAPE.test(newName)) return fail(t(lang, 'customcommands.nameShape'));
  if (oldName === newName) return fail(t(lang, 'customcommands.rename.same'));
  const row = await ccDb.getCommand(interaction.guild.id, oldName);
  if (!row) return fail(t(lang, 'customcommands.notExist', { name: oldName }));
  if (isRealCommand(interaction.client, newName)) return fail(t(lang, 'customcommands.realCommand', { name: newName }));
  if (await ccDb.getCommand(interaction.guild.id, newName)) return fail(t(lang, 'customcommands.rename.exists', { name: newName }));
  try {
    await ccDb.renameCommand(interaction.guild.id, oldName, newName);
  } catch (err) {
    if (err?.code === '23505') return fail(t(lang, 'customcommands.rename.taken', { name: newName }));
    throw err;
  }
  invalidateTriggers(interaction.guild.id);
  const prefix = guildPrefixes.primaryPrefix(await ensureGuild(interaction.guild.id).catch(() => null));
  const own = row.trigger_type === 'prefix' && row.trigger_text ? ` ${t(lang, 'customcommands.rename.ownPrefix', { own: row.trigger_text, name: newName })}` : '';
  return reply(interaction, `${t(lang, 'customcommands.rename.done', { emoji: EMOJI.APPROVE, old: oldName, name: newName, prefix })}${own}\n${t(lang, 'customcommands.rename.note')}`, COLORS.GREEN);
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await ccDb.removeCommand(interaction.guild.id, name);
  invalidateTriggers(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'customcommands.remove.done', { emoji: EMOJI.APPROVE }) : t(lang, 'customcommands.missing'), removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

/** The commands of the server a page at a time, sorted by name: what each one is, how it starts and how big it is. */
async function listCmd(interaction) {
  return sendPager(interaction, 'customcommands');
}

/** `!cc info req`: what a command is, how it starts, how big it is and what its code uses. */
async function infoCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) return reply(interaction, `${t(lang, 'customcommands.notExist', { name })}${await didYouMean(interaction.guild.id, name, lang)}`, COLORS.RED);
  const serverPrefix = guildPrefixes.primaryPrefix(await ensureGuild(interaction.guild.id).catch(() => null));
  const lines = [`### \`${row.name}\``, t(lang, row.code ? 'customcommands.info.kindCode' : 'customcommands.info.kindText'), t(lang, 'customcommands.info.startsWith', { trigger: describeTrigger(row, row.name, serverPrefix, lang) })];
  if (!row.code) {
    if (row.response) lines.push(tn(lang, 'customcommands.info.size', row.response.length, { count: row.response.length }));
    if (row.embed_template) lines.push(t(lang, 'customcommands.info.embedTemplate', { name: row.embed_template }));
    lines.push(t(lang, 'customcommands.info.seeText', { prefix: serverPrefix, name: row.name }));
    return reply(interaction, lines.join('\n'));
  }
  lines.push(t(lang, 'customcommands.info.sizeOf', { count: row.code.length, max: MAX_SOURCE_LENGTH }));
  const summary = codeSummary(row.code);
  if (summary) {
    const uses = [
      summary.storedData && 'storedData', summary.buttons && 'buttons', summary.menus && 'menus', summary.reactions && 'reactions',
      summary.forms && 'forms', summary.roles && 'roles', summary.directMessages && 'directMessages', summary.lookups && 'lookups',
      summary.otherCommands && 'otherCommands',
    ].filter(Boolean).map((use) => t(lang, `customcommands.info.use.${use}`));
    lines.push(t(lang, 'customcommands.info.uses', { uses: uses.length ? uses.join(', ') : t(lang, 'customcommands.info.usesNothing') }));
    lines.push(t(lang, 'customcommands.info.functions', { functions: summary.functions.length ? clipText(summary.functions.map((fn) => `\`${fn}\``).join(', '), 1200) : t(lang, 'customcommands.info.functionsNone') }));
  } else {
    lines.push(`${EMOJI.WARNING}  ${codeProblem(row.code, lang) ?? t(lang, 'customcommands.info.mistake')}`);
  }
  if (row.created_by) lines.push(t(lang, 'customcommands.info.writtenBy', { user: `<@${row.created_by}>` }));
  const hints = codeHintList(row.code, lang);
  if (hints.length) lines.push('', ...hints.slice(0, 5).map((hint) => t(lang, 'customcommands.hint', { hint: hint.text })));
  lines.push(t(lang, 'customcommands.info.seeCode', { prefix: serverPrefix, name: row.name }));
  return reply(interaction, lines.join('\n'));
}

/**
 * `!cc logs [name]`: the last problems of the commands in code of the server (or of one command): mistakes in the code,
 * crashes, actions that were not done and execCC calls that were refused. They are kept in memory, so a restart clears them.
 */
async function logsCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const typed = interaction.options.getString('name');
  const name = typed ? ccDb.normalizeName(typed).replace(/^[^a-z0-9_-]+/, '') : null;
  const entries = codeCommands.problemLog(interaction.guild.id, name);
  if (!entries.length) {
    return reply(interaction, name ? t(lang, 'customcommands.logs.noneOne', { name, max: codeCommands.MAX_PROBLEMS }) : t(lang, 'customcommands.logs.noneAll', { max: codeCommands.MAX_PROBLEMS }));
  }
  // A mistake of the code is said in the language of who reads it; the other problems stay in the language they were written in.
  const lines = entries.map((entry) => `**\`${entry.command}\`** · ${entry.trigger}${entry.userId ? ` · <@${entry.userId}>` : ''} · <t:${entry.at}:R>\n${clipText(entry.phrase ? String(say(lang, entry.phrase)).slice(0, 500) : entry.text, 300)}`);
  return reply(interaction, clipText([name ? t(lang, 'customcommands.logs.titleOne', { name }) : t(lang, 'customcommands.logs.titleAll'), ...lines].join('\n'), 3800) + `\n${t(lang, 'customcommands.logs.footer')}`);
}

async function varsCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  // The texts hold {variables} written for the reader: `t` is called without values so they stay as they are.
  const text = [
    t(lang, 'customcommands.vars.title'),
    t(lang, 'customcommands.vars.args'),
    t(lang, 'customcommands.vars.argN'),
    t(lang, 'customcommands.vars.argsFrom'),
    t(lang, 'customcommands.vars.argCount'),
    t(lang, 'customcommands.vars.commandName'),
    t(lang, 'customcommands.vars.prefix'),
    t(lang, 'customcommands.vars.embedVars'),
    '',
    t(lang, 'customcommands.vars.flagsTitle'),
    t(lang, 'customcommands.vars.reactreply'),
    '',
    t(lang, 'customcommands.vars.example'),
    t(lang, 'customcommands.vars.askInput'),
  ].join('\n');
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}

async function showCmd(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) {
    await interaction.editReply({ components: [textCard(t(lang, 'customcommands.missing'), COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const text = `**\`${row.name}\`**\n${row.embed_template ? t(lang, 'customcommands.show.template', { name: row.embed_template }) : ''}${row.response ? `\n${t(lang, 'customcommands.show.response', { response: row.response })}` : ''}`;
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}

// ── Commands written in code (Petto Code) ───────────────────────────────────

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
/** A long text goes in a file, sent as a normal message because a card cannot hold files. */
async function sendAsFile(interaction, content, fileName, text, lang) {
  await interaction.channel.send({ content, files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: fileName })], allowedMentions: { parse: [] } });
  return reply(interaction, t(lang, 'customcommands.code.sentAsFile', { emoji: EMOJI.APPROVE }), COLORS.GREEN);
}
const clipText = (text, max = 1500) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** When the code says it is used with a prefix of its own (`.req`) and the command does not have it, tell how to give it. */
async function missingPrefixWarning(interaction, name, code, serverPrefix, lang = currentLanguage()) {
  const hint = prefixHint(name, code);
  if (!hint) return '';
  const row = await ccDb.getCommand(interaction.guild.id, name).catch(() => null);
  if (row?.trigger_type === 'prefix' && row.trigger_text === hint.prefix) return '';
  const vars = { emoji: EMOJI.WARNING, own: hint.prefix, word: hint.word, name, prefix: serverPrefix };
  return `\n\n${t(lang, hint.word !== name ? 'customcommands.prefixWarning.rename' : 'customcommands.prefixWarning.plain', vars)}`;
}

/** `how` says how a new command was made: `created`, `template` or `imported`. */
async function saveCode(interaction, name, code, how, lang) {
  const saved = await saveCodeCommand({ guild: interaction.guild, client: interaction.client, userId: interaction.user.id, name, code, lang });
  if (!saved.ok) return reply(interaction, saved.message, COLORS.RED);
  // The commands are typed with the prefix of the server (`p!req1`), so the message says that one and not always `!`.
  const prefix = guildPrefixes.primaryPrefix(await ensureGuild(interaction.guild.id).catch(() => null));
  const warning = await missingPrefixWarning(interaction, name, code, prefix, lang);
  return reply(interaction, `${t(lang, `customcommands.saved.${saved.created ? how : 'updated'}`, { emoji: EMOJI.APPROVE, name, prefix })}${warning}`, warning ? COLORS.YELLOW : COLORS.GREEN);
}

async function codeCmd(interaction, sub) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!codeCommands.canWriteCode()) {
    return reply(interaction, t(lang, 'customcommands.code.off', { emoji: EMOJI.DENY }), COLORS.RED);
  }
  const raw = interaction.rawMessage?.content ?? '';

  if (sub === 'template') {
    const id = interaction.options.getString('id');
    if (!id) {
      const lines = TEMPLATES.map((template) => templateIn(template, lang)).map((template) => `\`${template.id}\` · **${template.name}**: ${template.description}`);
      return reply(interaction, `${t(lang, 'customcommands.template.title')}\n${lines.join('\n')}\n\n${t(lang, 'customcommands.template.footer')}`);
    }
    const template = byId(id);
    if (!template) return reply(interaction, t(lang, 'customcommands.template.missing', { id }), COLORS.RED);
    const name = ccDb.normalizeName(interaction.options.getString('name') ?? template.suggestedName);
    // Its sentences are installed in the language of the server: from then on they are the server's own.
    return saveCode(interaction, name, templateCode(template, lang), 'template', lang);
  }

  if (sub === 'code') {
    const name = ccDb.normalizeName(interaction.options.getString('name', true));
    const code = codeCommands.extractCode(codeCommands.rawAfter(raw, 1));
    return saveCode(interaction, name, code, 'created', lang);
  }

  if (sub === 'codetest') {
    // A code block can have arguments after it: `!cc codetest ```code``` a b` tries it as if `a b` were typed.
    const { code, args } = codeCommands.splitCodeArgs(codeCommands.rawAfter(raw, 0));
    const problem = codeProblem(code, lang);
    if (problem) return reply(interaction, problem, COLORS.RED);
    const hints = codeHintList(code, lang);
    try {
      const data = codeCommands.buildData(interaction.rawMessage, 'test', args, '!');
      const result = await run(code, data, { store: codeCommands.memoryStore(), lookup: codeCommands.lookupFor(interaction.guild), lang });
      const output = result.output.trim();
      const actions = result.effects.map((effect) => [`• ${describeEffect(effect, lang)}`, ...effectDetails(effect, lang).map((line) => `  ↳ ${line}`)].join('\n')).join('\n');
      return reply(interaction, [
        `${t(lang, 'customcommands.test.title')}${args ? `\n${t(lang, 'customcommands.test.args', { args: clipText(args, 200) })}` : ''}`,
        t(lang, 'customcommands.test.print', { output: output ? `\n${clipText(output)}` : t(lang, 'customcommands.test.nothing') }),
        t(lang, 'customcommands.test.do', { actions: actions ? `\n${clipText(actions, 1600)}` : t(lang, 'customcommands.test.nothingElse') }),
        ...hints.slice(0, 5).map((hint) => t(lang, 'customcommands.hint', { hint: hint.text })),
        t(lang, 'customcommands.test.stats', { steps: result.steps, millis: result.millis }),
      ].join('\n'));
    } catch (error) {
      if (error instanceof PettoCodeError) {
        // The mistake already says the name it meant, so only the other hints are added.
        const namesFunction = ['scripting.run.noFunction', 'scripting.run.noFunctionMeant', 'scripting.run.functionNotCalled'].includes(error.code);
        const more = hints.filter((hint) => !(hint.kind === 'function' && namesFunction && error.phrase.vars.name === hint.name));
        const detail = error.detailIn(lang);
        const stopped = error.line ? t(lang, 'customcommands.test.stoppedAt', { detail, line: error.line, column: error.column }) : t(lang, 'customcommands.test.stopped', { detail });
        return reply(interaction, [stopped, ...more.slice(0, 5).map((hint) => t(lang, 'customcommands.hint', { hint: hint.text }))].join('\n'), COLORS.RED);
      }
      throw error;
    }
  }

  if (sub === 'import') {
    let shared;
    try { shared = codeCommands.decodeShare(interaction.options.getString('share', true), lang); } catch (error) { return reply(interaction, error.message, COLORS.RED); }
    const name = ccDb.normalizeName(interaction.options.getString('name') ?? shared.name);
    if (!name) return reply(interaction, t(lang, 'customcommands.import.noName'), COLORS.RED);
    return saveCode(interaction, name, shared.code, 'imported', lang);
  }

  // codeshow and export
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row?.code) return reply(interaction, `${t(lang, 'customcommands.code.notCode', { name })}${row ? '' : await didYouMean(interaction.guild.id, name, lang)}`, COLORS.RED);
  if (sub === 'export') {
    const share = codeCommands.encodeShare({ name: row.name, code: row.code });
    if (share.length > 1800) return sendAsFile(interaction, t(lang, 'customcommands.export.longFile', { name: row.name }), `${row.name}.pc1.txt`, share, lang);
    return reply(interaction, `${t(lang, 'customcommands.export.done', { name: row.name })}\n\`\`\`\n${share}\n\`\`\``);
  }
  if (row.code.length > 1700) return sendAsFile(interaction, t(lang, 'customcommands.code.longFile', { name: row.name }), `${row.name}.txt`, row.code, lang);
  // handlebars is the language Discord colors `{{ }}` best with: the actions stand out from the text around them.
  return reply(interaction, `**\`${row.name}\`**\n\`\`\`handlebars\n${row.code}\n\`\`\``);
}

module.exports.missingPrefixWarning = missingPrefixWarning;

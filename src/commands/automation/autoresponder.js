// Prefix command and configuration flow for per-guild autoresponders.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const arDb = require('../../db/autoResponders');
const { getTemplate } = require('../../db/embedTemplates');
const { resolveChannels } = require('../../utils/channelResolve');
const { resolveRoles } = require('../../utils/roleResolve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { looksLikeScript } = require('../../utils/embedScript');
const { payloadFromCode } = require('../../utils/embedCodeMessage');
const { autoresponderAdd, autoresponderEdit } = require('../../utils/codeArgs');
const { t, tn, languageOf } = require('../../i18n');

const MODE_CHOICES = [
  { name: 'contains', value: 'contains' },
  { name: 'starts with', value: 'startsWith' },
  { name: 'ends with', value: 'endsWith' },
  { name: 'exact match', value: 'exact' },
  { name: 'regex', value: 'regex' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoresponder')
    .setDescription('Auto-reply to trigger words/phrases.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add an autoresponder.')
        .addStringOption((o) => o.setName('trigger').setDescription('Text to watch for').setRequired(true))
        .addStringOption((o) => o.setName('reply').setDescription('Reply text/flags, e.g. {reactreply:🌸}. Optional with embed_template.').setRequired(false))
        .addStringOption((o) => o.setName('mode').setDescription('Match mode (default contains)').setRequired(false).addChoices(...MODE_CHOICES))
        .addBooleanOption((o) => o.setName('embed').setDescription('Send the reply text as a simple embed').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Saved !embed template to send; supports {args}, {user}, etc.').setRequired(false))
        .addBooleanOption((o) => o.setName('delete_trigger').setDescription('Delete the triggering message').setRequired(false))
        .addBooleanOption((o) => o.setName('reply_to_message').setDescription('Reply directly to (quote) the triggering message instead of sending a new one').setRequired(false))
        .addBooleanOption((o) => o.setName('ping_user').setDescription('Notify the triggering user (as a reply, no ugly @mention text stuffed in)').setRequired(false))
        .addStringOption((o) => o.setName('channels').setDescription('Restrict to these channels (space-separated mentions; default: all channels)').setRequired(false))
        .addStringOption((o) => o.setName('roles').setDescription('Only trigger for members with one of these roles (space-separated mentions; default: everyone)').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Remove an autoresponder by its trigger text.').addStringOption((o) => o.setName('trigger').setDescription('Trigger text').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit an existing autoresponder.')
        .addStringOption((o) => o.setName('id').setDescription('Autoresponder ID (see !autoresponder list)').setRequired(true))
        .addStringOption((o) => o.setName('mode').setDescription('New match mode').setRequired(false).addChoices(...MODE_CHOICES))
        .addBooleanOption((o) => o.setName('embed').setDescription('New reply type').setRequired(false))
        .addBooleanOption((o) => o.setName('delete_trigger').setDescription('New delete-trigger setting').setRequired(false))
        .addBooleanOption((o) => o.setName('reply_to_message').setDescription('New reply-to-trigger setting').setRequired(false))
        .addBooleanOption((o) => o.setName('ping_user').setDescription('New ping-user setting').setRequired(false))
        .addStringOption((o) => o.setName('reply').setDescription('New reply text/flags; use clear to remove').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Saved !embed template; use clear to remove').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all autoresponders.'))
    .addSubcommand((s) => s.setName('show').setDescription('Show full details for one autoresponder.').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Delete every autoresponder in this server.'))

    .addSubcommandGroup((g) =>
      g
        .setName('channel')
        .setDescription('Restrict an autoresponder to specific channels.')
        .addSubcommand((s) => s.setName('add').setDescription('Add channels to an autoresponder.').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true)).addStringOption((o) => o.setName('channels').setDescription('Space-separated channel mentions').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove channels from an autoresponder.').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true)).addStringOption((o) => o.setName('channels').setDescription('Space-separated channel mentions').setRequired(true)))
        .addSubcommand((s) => s.setName('clear').setDescription('Clear channel restrictions (respond everywhere).').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true))),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('role')
        .setDescription('Restrict an autoresponder to members with specific roles.')
        .addSubcommand((s) => s.setName('add').setDescription('Add roles to an autoresponder.').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true)).addStringOption((o) => o.setName('roles').setDescription('Space-separated role mentions').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove roles from an autoresponder.').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true)).addStringOption((o) => o.setName('roles').setDescription('Space-separated role mentions').setRequired(true)))
        .addSubcommand((s) => s.setName('clear').setDescription('Clear role restrictions (respond to everyone).').addStringOption((o) => o.setName('id').setDescription('Autoresponder ID').setRequired(true))),
    ),
  aliases: ['ar'],
  // The reply can be an embed code, so these two read the raw text: `!ar add hi, {embed}$v{...} --reply --not_strict`.
  prefixRawOptions: { add: autoresponderAdd, edit: autoresponderEdit },

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'channel') return channelCmd(interaction, sub);
    if (group === 'role') return roleCmd(interaction, sub);

    switch (sub) {
      case 'add':
        return addCmd(interaction);
      case 'remove':
        return removeCmd(interaction);
      case 'edit':
        return editCmd(interaction);
      case 'list':
        return listCmd(interaction);
      case 'show':
        return showCmd(interaction);
      default:
        return resetCmd(interaction);
    }
  },
};

/**
 * When a reply is written as an embed code, builds it once to be sure Discord would take it. Returns the problem to show,
 * and the notes about parts that were left out.
 */
async function checkCode(interaction, trigger, reply, lang) {
  if (!reply || !looksLikeScript(reply)) return { problem: null, notes: [] };
  const member = interaction.member;
  const { payload, warnings, error } = await payloadFromCode(reply, { member, guild: interaction.guild, channel: interaction.channel, message: interaction.rawMessage, args: '', argTokens: [], commandName: trigger, prefix: '' });
  if (error) return { problem: t(lang, 'automation.autoresponder.codeRefused', { error }), notes: [] };
  if (!payload) return { problem: t(lang, 'automation.autoresponder.codeEmpty'), notes: [] };
  return { problem: null, notes: warnings };
}

function modeTag(mode) {
  const icons = { contains: '🔍', startsWith: '▶️', endsWith: '◀️', exact: '🎯', regex: '🧩' };
  return `${icons[mode] ?? ''} \`${mode}\``.trim();
}

const yesNo = (lang, value) => t(lang, value ? 'automation.common.yes' : 'automation.common.no');

/** The line of settings of an autoresponder: match, type, delete trigger, reply to message and ping user. */
function settingsLine(lang, { mode, type, deleteTrigger, replyToMessage, pingUser }) {
  return t(lang, 'automation.autoresponder.settings', { mode: modeTag(mode), type, deleteTrigger: yesNo(lang, deleteTrigger), replyToMessage: yesNo(lang, replyToMessage), pingUser: yesNo(lang, pingUser) });
}

async function addCmd(interaction) {
  const lang = await languageOf(interaction);
  const trigger = interaction.options.getString('trigger', true);
  const reply = interaction.options.getString('reply');
  const mode = interaction.options.getString('mode') ?? 'contains';
  const embed = interaction.options.getBoolean('embed') ?? false;
  const embedTemplate = interaction.options.getString('embed_template');
  const deleteTrigger = interaction.options.getBoolean('delete_trigger') ?? false;
  const replyToMessage = interaction.options.getBoolean('reply_to_message') ?? false;
  const pingUser = interaction.options.getBoolean('ping_user') ?? false;
  const channelsInput = interaction.options.getString('channels');
  const rolesInput = interaction.options.getString('roles');

  if (mode === 'regex') {
    try {
      new RegExp(trigger);
    } catch {
      await interaction.reply({ content: t(lang, 'automation.autoresponder.invalidRegex', { pattern: trigger }), flags: MessageFlags.Ephemeral });
      return;
    }
  }

  let channelIds = [];
  if (channelsInput) {
    const { resolved } = resolveChannels(interaction.guild, channelsInput);
    channelIds = resolved.map((c) => c.id);
  }

  let roleIds = [];
  if (rolesInput) {
    const { resolved } = resolveRoles(interaction.guild, rolesInput);
    roleIds = resolved.map((r) => r.id);
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (!reply && !embedTemplate) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.needReply'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate);
    if (!template) {
      await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.templateMissing', { name: embedTemplate }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  const code = await checkCode(interaction, trigger, reply, lang);
  if (code.problem) {
    await interaction.editReply({ components: [textCard(code.problem, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  let ar;
  try {
    ar = await arDb.create(interaction.guild.id, {
      trigger,
      reply: reply ?? '',
      embed_template: embedTemplate ?? null,
      match_mode: mode,
      reply_type: embed ? 'embed' : 'text',
      delete_trigger: deleteTrigger,
      reply_to_trigger: replyToMessage,
      ping_user: pingUser,
      channel_ids: channelIds,
      role_ids: roleIds,
    });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : t(lang, 'automation.autoresponder.createFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    t(lang, 'automation.autoresponder.added', { emoji: EMOJI.APPROVE, id: ar.ar_id }),
    settingsLine(lang, { mode, type: embedTemplate ? t(lang, 'automation.autoresponder.type.savedEmbed', { name: embedTemplate }) : t(lang, reply && looksLikeScript(reply) ? 'automation.autoresponder.type.embedCode' : (embed ? 'automation.autoresponder.type.embed' : 'automation.autoresponder.type.text')), deleteTrigger, replyToMessage, pingUser }),
    t(lang, 'automation.autoresponder.channels', { channels: channelIds.length ? channelIds.map((id) => `<#${id}>`).join(' ') : t(lang, 'automation.autoresponder.allChannels') }),
    t(lang, 'automation.autoresponder.roles', { roles: roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(' ') : t(lang, 'automation.autoresponder.everyone') }),
    t(lang, 'automation.autoresponder.trigger', { trigger }),
    t(lang, 'automation.autoresponder.replyFlags', { reply: reply ? (reply.length > 300 ? `${reply.slice(0, 300)}…` : reply) : t(lang, 'automation.common.none') }),
    ...code.notes.map((line) => `- ${line}`),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const trigger = interaction.options.getString('trigger', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await arDb.removeByTrigger(interaction.guild.id, trigger);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'automation.autoresponder.removed', { emoji: EMOJI.APPROVE, trigger }) : t(lang, 'automation.autoresponder.notFoundTrigger', { trigger }), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function editCmd(interaction) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getString('id', true);
  const mode = interaction.options.getString('mode');
  const embed = interaction.options.getBoolean('embed');
  const deleteTrigger = interaction.options.getBoolean('delete_trigger');
  const replyToMessage = interaction.options.getBoolean('reply_to_message');
  const pingUser = interaction.options.getBoolean('ping_user');
  const reply = interaction.options.getString('reply');
  const embedTemplateInput = interaction.options.getString('embed_template');

  if (!mode && embed == null && deleteTrigger == null && replyToMessage == null && pingUser == null && reply == null && embedTemplateInput == null) {
    await interaction.reply({ content: t(lang, 'automation.autoresponder.needField'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const patch = {};
  if (mode) patch.match_mode = mode;
  if (embed != null) patch.reply_type = embed ? 'embed' : 'text';
  if (deleteTrigger != null) patch.delete_trigger = deleteTrigger;
  if (replyToMessage != null) patch.reply_to_trigger = replyToMessage;
  if (pingUser != null) patch.ping_user = pingUser;
  if (reply != null) patch.reply = reply.trim().toLowerCase() === 'clear' ? '' : reply;

  let notes = [];
  if (patch.reply) {
    const code = await checkCode(interaction, id, patch.reply, lang);
    if (code.problem) {
      await interaction.editReply({ components: [textCard(code.problem, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    notes = code.notes;
  }

  if (embedTemplateInput != null) {
    if (embedTemplateInput.trim().toLowerCase() === 'clear') {
      patch.embed_template = null;
    } else {
      const template = await getTemplate(interaction.guild.id, embedTemplateInput);
      if (!template) {
        await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.templateMissing', { name: embedTemplateInput }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      patch.embed_template = embedTemplateInput;
    }
  }

  const updated = await arDb.update(interaction.guild.id, id, patch);
  await interaction.editReply({ components: [textCard(updated ? [t(lang, 'automation.autoresponder.updated', { emoji: EMOJI.APPROVE, id }), ...notes.map((line) => `- ${line}`)].join('\n') : t(lang, 'automation.autoresponder.notFound', { id }), updated ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const list = await arDb.listForGuild(interaction.guild.id);
  if (!list.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.listEmpty'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = list.map((a) => {
    const reply = a.reply ?? '';
    const output = a.embed_template ? `embed:\`${a.embed_template}\`` : (reply.length > 60 ? `${reply.slice(0, 60)}…` : (reply || t(lang, 'automation.autoresponder.noText')));
    return `\`${a.ar_id}\` ${modeTag(a.match_mode)}${(a.reply_type === 'embed' || a.embed_template) ? ' 🖼️' : ''}${a.delete_trigger ? ' 🗑️' : ''}${a.role_ids?.length ? ' 🎭' : ''}${a.ping_user ? ' 🔔' : ''} · **${a.trigger}** → ${output}`;
  });
  await interaction.editReply({ components: [textCard(`${t(lang, 'automation.autoresponder.listTitle', { count: list.length, max: await arDb.limitFor(interaction.guild.id) })}\n${lines.join('\n')}`.slice(0, 3900), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function showCmd(interaction) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getString('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const ar = await arDb.getById(interaction.guild.id, id);
  if (!ar) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.notFound', { id }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    t(lang, 'automation.autoresponder.showTitle', { id: ar.ar_id }),
    settingsLine(lang, { mode: ar.match_mode, type: t(lang, ar.reply_type === 'embed' ? 'automation.autoresponder.type.embed' : 'automation.autoresponder.type.text'), deleteTrigger: ar.delete_trigger, replyToMessage: ar.reply_to_trigger, pingUser: ar.ping_user }),
    t(lang, 'automation.autoresponder.channels', { channels: ar.channel_ids.length ? ar.channel_ids.map((id2) => `<#${id2}>`).join(' ') : t(lang, 'automation.autoresponder.allChannels') }),
    t(lang, 'automation.autoresponder.roles', { roles: ar.role_ids.length ? ar.role_ids.map((id2) => `<@&${id2}>`).join(' ') : t(lang, 'automation.autoresponder.everyone') }),
    t(lang, 'automation.autoresponder.trigger', { trigger: ar.trigger }),
    t(lang, 'automation.autoresponder.embedTemplate', { template: ar.embed_template ? `\`${ar.embed_template}\`` : t(lang, 'automation.common.none') }),
    t(lang, 'automation.autoresponder.replyFlags', { reply: ar.reply || t(lang, 'automation.common.none') }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function resetCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await arDb.removeAllForGuild(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? tn(lang, 'automation.autoresponder.resetDone', removed, { count: removed, emoji: EMOJI.APPROVE }) : t(lang, 'automation.autoresponder.resetEmpty'), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function channelCmd(interaction, sub) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getString('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const ar = await arDb.getById(interaction.guild.id, id);
  if (!ar) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.notFound', { id }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'clear') {
    await arDb.update(interaction.guild.id, id, { channel_ids: [] });
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.channelClear', { emoji: EMOJI.APPROVE, id }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const { resolved } = resolveChannels(interaction.guild, interaction.options.getString('channels', true));
  if (!resolved.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.noValidChannels'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const current = new Set(ar.channel_ids);
  if (sub === 'add') resolved.forEach((c) => current.add(c.id));
  else resolved.forEach((c) => current.delete(c.id));

  const updated = await arDb.update(interaction.guild.id, id, { channel_ids: [...current] });
  const text = t(lang, 'automation.autoresponder.activeIn', { emoji: EMOJI.APPROVE, id, channels: updated.channel_ids.length ? updated.channel_ids.map((cid) => `<#${cid}>`).join(' ') : t(lang, 'automation.autoresponder.allChannelsLower') });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function roleCmd(interaction, sub) {
  const lang = await languageOf(interaction);
  const id = interaction.options.getString('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const ar = await arDb.getById(interaction.guild.id, id);
  if (!ar) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.notFound', { id }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'clear') {
    await arDb.update(interaction.guild.id, id, { role_ids: [] });
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.roleClear', { emoji: EMOJI.APPROVE, id }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const { resolved } = resolveRoles(interaction.guild, interaction.options.getString('roles', true));
  if (!resolved.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'automation.autoresponder.noValidRoles'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const current = new Set(ar.role_ids);
  if (sub === 'add') resolved.forEach((r) => current.add(r.id));
  else resolved.forEach((r) => current.delete(r.id));

  const updated = await arDb.update(interaction.guild.id, id, { role_ids: [...current] });
  const text = t(lang, 'automation.autoresponder.requires', { emoji: EMOJI.APPROVE, id, roles: updated.role_ids.length ? updated.role_ids.map((rid) => `<@&${rid}>`).join(' ') : t(lang, 'automation.autoresponder.noRoleEveryone') });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const arDb = require('../../db/autoResponders');
const { resolveChannels } = require('../../utils/channelResolve');
const { resolveRoles } = require('../../utils/roleResolve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

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
        .addStringOption((o) => o.setName('reply').setDescription('What to reply with').setRequired(true))
        .addStringOption((o) => o.setName('mode').setDescription('Match mode (default contains)').setRequired(false).addChoices(...MODE_CHOICES))
        .addBooleanOption((o) => o.setName('embed').setDescription('Send the reply as an embed instead of plain text').setRequired(false))
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
        .addStringOption((o) => o.setName('id').setDescription('Autoresponder ID (see /autoresponder list)').setRequired(true))
        .addStringOption((o) => o.setName('mode').setDescription('New match mode').setRequired(false).addChoices(...MODE_CHOICES))
        .addBooleanOption((o) => o.setName('embed').setDescription('New reply type').setRequired(false))
        .addBooleanOption((o) => o.setName('delete_trigger').setDescription('New delete-trigger setting').setRequired(false))
        .addBooleanOption((o) => o.setName('reply_to_message').setDescription('New reply-to-trigger setting').setRequired(false))
        .addBooleanOption((o) => o.setName('ping_user').setDescription('New ping-user setting').setRequired(false))
        .addStringOption((o) => o.setName('reply').setDescription('New reply text').setRequired(false)),
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

function modeTag(mode) {
  const icons = { contains: '🔍', startsWith: '▶️', endsWith: '◀️', exact: '🎯', regex: '🧩' };
  return `${icons[mode] ?? ''} \`${mode}\``.trim();
}

async function addCmd(interaction) {
  const trigger = interaction.options.getString('trigger', true);
  const reply = interaction.options.getString('reply', true);
  const mode = interaction.options.getString('mode') ?? 'contains';
  const embed = interaction.options.getBoolean('embed') ?? false;
  const deleteTrigger = interaction.options.getBoolean('delete_trigger') ?? false;
  const replyToMessage = interaction.options.getBoolean('reply_to_message') ?? false;
  const pingUser = interaction.options.getBoolean('ping_user') ?? false;
  const channelsInput = interaction.options.getString('channels');
  const rolesInput = interaction.options.getString('roles');

  if (mode === 'regex') {
    try {
      new RegExp(trigger);
    } catch {
      await interaction.reply({ content: `Invalid regex pattern: \`${trigger}\``, flags: MessageFlags.Ephemeral });
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

  let ar;
  try {
    ar = await arDb.create(interaction.guild.id, {
      trigger,
      reply,
      match_mode: mode,
      reply_type: embed ? 'embed' : 'text',
      delete_trigger: deleteTrigger,
      reply_to_trigger: replyToMessage,
      ping_user: pingUser,
      channel_ids: channelIds,
      role_ids: roleIds,
    });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : 'Failed to create autoresponder.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    `${EMOJI.APPROVE}  Autoresponder \`${ar.ar_id}\` added.`,
    `**Match:** ${modeTag(mode)}  ·  **Type:** ${embed ? 'Embed' : 'Text'}  ·  **Delete trigger:** ${deleteTrigger ? 'Yes' : 'No'}  ·  **Reply to message:** ${replyToMessage ? 'Yes' : 'No'}  ·  **Ping user:** ${pingUser ? 'Yes' : 'No'}`,
    `**Channels:** ${channelIds.length ? channelIds.map((id) => `<#${id}>`).join(' ') : 'All channels'}`,
    `**Roles:** ${roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(' ') : 'Everyone'}`,
    `**Trigger:** ${trigger}`,
    `**Reply:** ${reply.length > 300 ? `${reply.slice(0, 300)}…` : reply}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const trigger = interaction.options.getString('trigger', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await arDb.removeByTrigger(interaction.guild.id, trigger);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed the autoresponder for \`${trigger}\`.` : `No autoresponder with trigger \`${trigger}\` found.`, removed ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function editCmd(interaction) {
  const id = interaction.options.getString('id', true);
  const mode = interaction.options.getString('mode');
  const embed = interaction.options.getBoolean('embed');
  const deleteTrigger = interaction.options.getBoolean('delete_trigger');
  const replyToMessage = interaction.options.getBoolean('reply_to_message');
  const pingUser = interaction.options.getBoolean('ping_user');
  const reply = interaction.options.getString('reply');

  if (!mode && embed == null && deleteTrigger == null && replyToMessage == null && pingUser == null && !reply) {
    await interaction.reply({ content: 'Provide at least one field to change.', flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = {};
  if (mode) patch.match_mode = mode;
  if (embed != null) patch.reply_type = embed ? 'embed' : 'text';
  if (deleteTrigger != null) patch.delete_trigger = deleteTrigger;
  if (replyToMessage != null) patch.reply_to_trigger = replyToMessage;
  if (pingUser != null) patch.ping_user = pingUser;
  if (reply) patch.reply = reply;

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const updated = await arDb.update(interaction.guild.id, id, patch);
  await interaction.editReply({ components: [textCard(updated ? `${EMOJI.APPROVE}  Autoresponder \`${id}\` updated.` : `No autoresponder with ID \`${id}\` found.`, updated ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const list = await arDb.listForGuild(interaction.guild.id);
  if (!list.length) {
    await interaction.editReply({ components: [textCard(`No autoresponders configured. Use \`/autoresponder add\`.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = list.map((a) => `\`${a.ar_id}\` ${modeTag(a.match_mode)}${a.reply_type === 'embed' ? ' 🖼️' : ''}${a.delete_trigger ? ' 🗑️' : ''}${a.role_ids?.length ? ' 🎭' : ''}${a.ping_user ? ' 🔔' : ''} · **${a.trigger}** → ${a.reply.length > 60 ? `${a.reply.slice(0, 60)}…` : a.reply}`);
  await interaction.editReply({ components: [textCard(`**Autoresponders (${list.length}/${arDb.MAX_PER_GUILD}):**\n${lines.join('\n')}`.slice(0, 3900), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function showCmd(interaction) {
  const id = interaction.options.getString('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const ar = await arDb.getById(interaction.guild.id, id);
  if (!ar) {
    await interaction.editReply({ components: [textCard(`No autoresponder with ID \`${id}\` found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    `### Autoresponder \`${ar.ar_id}\``,
    `**Match:** ${modeTag(ar.match_mode)}  ·  **Type:** ${ar.reply_type === 'embed' ? 'Embed' : 'Text'}  ·  **Delete trigger:** ${ar.delete_trigger ? 'Yes' : 'No'}  ·  **Reply to message:** ${ar.reply_to_trigger ? 'Yes' : 'No'}  ·  **Ping user:** ${ar.ping_user ? 'Yes' : 'No'}`,
    `**Channels:** ${ar.channel_ids.length ? ar.channel_ids.map((id2) => `<#${id2}>`).join(' ') : 'All channels'}`,
    `**Roles:** ${ar.role_ids.length ? ar.role_ids.map((id2) => `<@&${id2}>`).join(' ') : 'Everyone'}`,
    `**Trigger:** ${ar.trigger}`,
    `**Reply:** ${ar.reply}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function resetCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await arDb.removeAllForGuild(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed all **${removed}** autoresponder(s).` : 'No autoresponders to remove.', removed ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

// ── channel group ────────────────────────────────────────────────────────────

async function channelCmd(interaction, sub) {
  const id = interaction.options.getString('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const ar = await arDb.getById(interaction.guild.id, id);
  if (!ar) {
    await interaction.editReply({ components: [textCard(`No autoresponder with ID \`${id}\` found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'clear') {
    await arDb.update(interaction.guild.id, id, { channel_ids: [] });
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  \`${id}\` will now respond in all channels.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const { resolved } = resolveChannels(interaction.guild, interaction.options.getString('channels', true));
  if (!resolved.length) {
    await interaction.editReply({ components: [textCard('No valid channels found in that input.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const current = new Set(ar.channel_ids);
  if (sub === 'add') resolved.forEach((c) => current.add(c.id));
  else resolved.forEach((c) => current.delete(c.id));

  const updated = await arDb.update(interaction.guild.id, id, { channel_ids: [...current] });
  const text = `${EMOJI.APPROVE}  \`${id}\` is now active in: ${updated.channel_ids.length ? updated.channel_ids.map((cid) => `<#${cid}>`).join(' ') : 'all channels'}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

// ── role group ───────────────────────────────────────────────────────────────

async function roleCmd(interaction, sub) {
  const id = interaction.options.getString('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const ar = await arDb.getById(interaction.guild.id, id);
  if (!ar) {
    await interaction.editReply({ components: [textCard(`No autoresponder with ID \`${id}\` found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'clear') {
    await arDb.update(interaction.guild.id, id, { role_ids: [] });
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  \`${id}\` will now respond to everyone.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const { resolved } = resolveRoles(interaction.guild, interaction.options.getString('roles', true));
  if (!resolved.length) {
    await interaction.editReply({ components: [textCard('No valid roles found in that input.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const current = new Set(ar.role_ids);
  if (sub === 'add') resolved.forEach((r) => current.add(r.id));
  else resolved.forEach((r) => current.delete(r.id));

  const updated = await arDb.update(interaction.guild.id, id, { role_ids: [...current] });
  const text = `${EMOJI.APPROVE}  \`${id}\` now requires one of: ${updated.role_ids.length ? updated.role_ids.map((rid) => `<@&${rid}>`).join(' ') : 'no role (everyone)'}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

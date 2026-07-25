const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const arDb = require('../../db/autoResponders');
const { resolveChannels } = require('../../utils/channelResolve');
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
        .addStringOption((o) => o.setName('channels').setDescription('Restrict to these channels (space-separated mentions; default: all channels)').setRequired(false)),
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
    ),
  aliases: ['ar'],

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'channel') return channelCmd(interaction, sub);

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
  const channelsInput = interaction.options.getString('channels');

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

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  let ar;
  try {
    ar = await arDb.create(interaction.guild.id, { trigger, reply, match_mode: mode, reply_type: embed ? 'embed' : 'text', delete_trigger: deleteTrigger, channel_ids: channelIds });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : 'Failed to create autoresponder.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    `${EMOJI.APPROVE}  Autoresponder \`${ar.ar_id}\` added.`,
    `**Match:** ${modeTag(mode)}  ·  **Type:** ${embed ? 'Embed' : 'Text'}  ·  **Delete trigger:** ${deleteTrigger ? 'Yes' : 'No'}`,
    `**Channels:** ${channelIds.length ? channelIds.map((id) => `<#${id}>`).join(' ') : 'All channels'}`,
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
  const reply = interaction.options.getString('reply');

  if (!mode && embed == null && deleteTrigger == null && !reply) {
    await interaction.reply({ content: 'Provide at least one field to change.', flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = {};
  if (mode) patch.match_mode = mode;
  if (embed != null) patch.reply_type = embed ? 'embed' : 'text';
  if (deleteTrigger != null) patch.delete_trigger = deleteTrigger;
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

  const lines = list.map((a) => `\`${a.ar_id}\` ${modeTag(a.match_mode)}${a.reply_type === 'embed' ? ' 🖼️' : ''}${a.delete_trigger ? ' 🗑️' : ''} · **${a.trigger}** → ${a.reply.length > 60 ? `${a.reply.slice(0, 60)}…` : a.reply}`);
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
    `**Match:** ${modeTag(ar.match_mode)}  ·  **Type:** ${ar.reply_type === 'embed' ? 'Embed' : 'Text'}  ·  **Delete trigger:** ${ar.delete_trigger ? 'Yes' : 'No'}`,
    `**Channels:** ${ar.channel_ids.length ? ar.channel_ids.map((id2) => `<#${id2}>`).join(' ') : 'All channels'}`,
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

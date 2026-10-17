const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { resolveUsers } = require('../../utils/userResolve');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['v'],
  // Each action asks for its own permission, not all three voice permissions at once.
  prefixPermissionOverrides: {
    mute: PermissionFlagsBits.MuteMembers,
    unmute: PermissionFlagsBits.MuteMembers,
    deafen: PermissionFlagsBits.DeafenMembers,
    undeafen: PermissionFlagsBits.DeafenMembers,
    disconnect: PermissionFlagsBits.MoveMembers,
    kick: PermissionFlagsBits.MoveMembers,
    move: PermissionFlagsBits.MoveMembers,
    drag: PermissionFlagsBits.MoveMembers,
  },
  prefixSubcommandAliases: { kick: 'disconnect', dc: 'disconnect', deaf: 'deafen', undeaf: 'undeafen' },
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Moderate members currently in a voice channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers | PermissionFlagsBits.MoveMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('mute')
        .setDescription('Server-mute a member in voice.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to voice-mute').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the voice mute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unmute')
        .setDescription('Remove a server voice-mute from a member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to voice-unmute').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the voice unmute').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('deafen')
        .setDescription('Server-deafen a member in voice.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to voice-deafen').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the voice deafen').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('undeafen')
        .setDescription('Remove a server voice-deafen from a member.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to voice-undeafen').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the voice undeafen').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('disconnect')
        .setDescription('Disconnect a member from their current voice channel.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to disconnect').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the disconnect').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('move')
        .setDescription('Move a member to another voice channel.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to move').setRequired(true))
        .addChannelOption((opt) => opt.setName('channel').setDescription('Destination voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the move').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('drag')
        .setDescription('Move one or more members to a voice channel (default: yours).')
        .addStringOption((opt) => opt.setName('users').setDescription('Mentions or IDs, separated by spaces').setRequired(true))
        .addChannelOption((opt) => opt.setName('channel').setDescription('Destination voice channel (default: the one you are in)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'mute') return setMute(interaction, true);
    if (sub === 'unmute') return setMute(interaction, false);
    if (sub === 'deafen') return setDeaf(interaction, true);
    if (sub === 'undeafen') return setDeaf(interaction, false);
    if (sub === 'disconnect') return disconnect(interaction);
    if (sub === 'drag') return drag(interaction);
    return move(interaction);
  },
};

const REQUIRED_PERMISSION = {
  mute: PermissionFlagsBits.MuteMembers,
  deaf: PermissionFlagsBits.DeafenMembers,
  disconnect: PermissionFlagsBits.MoveMembers,
  move: PermissionFlagsBits.MoveMembers,
};

async function resolveTarget(interaction, kind, lang) {
  const targetUser = interaction.options.getUser('user', true);
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return null;
  }

  const check = canModerate(interaction, targetMember, REQUIRED_PERMISSION[kind], { hierarchy: 'none' });
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return null;
  }

  if (!targetMember.voice.channelId) {
    await interaction.reply({ content: t(lang, 'moderation.voice.notInVoice', { user: `${targetUser}` }), flags: MessageFlags.Ephemeral });
    return null;
  }

  return { targetUser, targetMember };
}

// The reason line under a voice action, when one was given.
function reasonSuffix(reason, lang) {
  return reason ? `\n${t(lang, 'moderation.common.reason', { reason })}` : '';
}

async function setMute(interaction, muted) {
  const lang = await languageOf(interaction);
  const resolved = await resolveTarget(interaction, 'mute', lang);
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.setMute(muted, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to set voice mute state:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.voice.muteFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${t(lang, muted ? 'moderation.voice.muted' : 'moderation.voice.unmuted', { emoji: muted ? EMOJI.ALERT : EMOJI.APPROVE, user: `${targetUser}` })}${reasonSuffix(reason, lang)}`;
  await interaction.editReply({ components: [textCard(text, muted ? 0xfed53c : 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function setDeaf(interaction, deafened) {
  const lang = await languageOf(interaction);
  const resolved = await resolveTarget(interaction, 'deaf', lang);
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.setDeaf(deafened, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to set voice deafen state:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.voice.deafenFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${t(lang, deafened ? 'moderation.voice.deafened' : 'moderation.voice.undeafened', { emoji: deafened ? EMOJI.ALERT : EMOJI.APPROVE, user: `${targetUser}` })}${reasonSuffix(reason, lang)}`;
  await interaction.editReply({ components: [textCard(text, deafened ? 0xfed53c : 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function disconnect(interaction) {
  const lang = await languageOf(interaction);
  const resolved = await resolveTarget(interaction, 'disconnect', lang);
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.disconnect(reason ?? undefined);
  } catch (err) {
    logger.error('Failed to disconnect member from voice:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.voice.disconnectFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${t(lang, 'moderation.voice.disconnected', { emoji: EMOJI.HAMMER, user: `${targetUser}` })}${reasonSuffix(reason, lang)}`;
  await interaction.editReply({ components: [textCard(text, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });
}

async function move(interaction) {
  const lang = await languageOf(interaction);
  const resolved = await resolveTarget(interaction, 'move', lang);
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const destination = interaction.options.getChannel('channel', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await interaction.reply({ content: t(lang, 'moderation.voice.needsMoveMembers'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.setChannel(destination.id, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to move member in voice:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.voice.moveFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${t(lang, 'moderation.voice.moved', { emoji: EMOJI.APPROVE, user: `${targetUser}`, channel: `${destination}` })}${reasonSuffix(reason, lang)}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

/** `voice drag` (`!drag`): several members to one voice channel, each one checked like a single move. */
async function drag(interaction) {
  const lang = await languageOf(interaction);
  const destination = interaction.options.getChannel('channel') ?? interaction.member.voice?.channel ?? null;
  if (!destination) {
    await interaction.reply({ content: t(lang, 'moderation.voice.dragNoChannel'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!destination.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect])) {
    await interaction.reply({ content: t(lang, 'moderation.voice.needsMoveMembers'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const { users, failed: notFound } = await resolveUsers(interaction.client, interaction.options.getString('users', true), interaction.guild);
  const moved = [];
  const skipped = [];
  for (const user of users.slice(0, 25)) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    // Moving yourself is fine; anyone else is checked like a single move.
    const check = member && member.id !== interaction.user.id ? canModerate(interaction, member, PermissionFlagsBits.MoveMembers, { hierarchy: 'none' }) : { ok: Boolean(member) };
    if (!member?.voice.channelId || !check.ok || member.voice.channelId === destination.id) {
      skipped.push(user);
      continue;
    }
    const ok = await member.voice.setChannel(destination.id, t(lang, 'moderation.voice.audit.dragged', { user: interaction.user.tag })).then(() => true, (err) => {
      logger.warn(`voice drag: could not move ${member.id}: ${err.message}`);
      return false;
    });
    (ok ? moved : skipped).push(user);
  }

  const lines = [tn(lang, 'moderation.voice.dragged', moved.length, { emoji: moved.length ? EMOJI.APPROVE : EMOJI.DENY, count: moved.length, channel: `${destination}` })];
  if (moved.length) lines.push(moved.map((user) => `${user}`).join(' '));
  if (skipped.length) lines.push(t(lang, 'moderation.voice.dragSkipped', { list: skipped.map((user) => `${user}`).join(' ') }));
  if (notFound.length) lines.push(t(lang, 'moderation.common.notFound', { list: notFound.map((id) => `\`${id}\``).join(', ') }));
  await interaction.editReply({ components: [textCard(lines.join('\n'), moved.length ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

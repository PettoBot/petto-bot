const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  aliases: ['v'],
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
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'mute') return setMute(interaction, true);
    if (sub === 'unmute') return setMute(interaction, false);
    if (sub === 'deafen') return setDeaf(interaction, true);
    if (sub === 'undeafen') return setDeaf(interaction, false);
    if (sub === 'disconnect') return disconnect(interaction);
    return move(interaction);
  },
};

const REQUIRED_PERMISSION = {
  mute: PermissionFlagsBits.MuteMembers,
  deaf: PermissionFlagsBits.DeafenMembers,
  disconnect: PermissionFlagsBits.MoveMembers,
  move: PermissionFlagsBits.MoveMembers,
};

async function resolveTarget(interaction, kind) {
  const targetUser = interaction.options.getUser('user', true);
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const check = canModerate(interaction, targetMember, REQUIRED_PERMISSION[kind]);
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return null;
  }

  if (!targetMember.voice.channelId) {
    await interaction.reply({ content: `${targetUser} is not currently in a voice channel.`, flags: MessageFlags.Ephemeral });
    return null;
  }

  return { targetUser, targetMember };
}

async function setMute(interaction, muted) {
  const resolved = await resolveTarget(interaction, 'mute');
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.setMute(muted, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to set voice mute state:', err);
    await interaction.editReply({ components: [textCard('I was unable to change that member\'s voice mute state.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${muted ? EMOJI.ALERT : EMOJI.APPROVE}  ${muted ? 'Voice-muted' : 'Voice-unmuted'} ${targetUser}.${reason ? `\n**Reason:** ${reason}` : ''}`;
  await interaction.editReply({ components: [textCard(text, muted ? 0xfed53c : 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function setDeaf(interaction, deafened) {
  const resolved = await resolveTarget(interaction, 'deaf');
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.setDeaf(deafened, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to set voice deafen state:', err);
    await interaction.editReply({ components: [textCard('I was unable to change that member\'s voice deafen state.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${deafened ? EMOJI.ALERT : EMOJI.APPROVE}  ${deafened ? 'Voice-deafened' : 'Voice-undeafened'} ${targetUser}.${reason ? `\n**Reason:** ${reason}` : ''}`;
  await interaction.editReply({ components: [textCard(text, deafened ? 0xfed53c : 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function disconnect(interaction) {
  const resolved = await resolveTarget(interaction, 'disconnect');
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const reason = interaction.options.getString('reason');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.disconnect(reason ?? undefined);
  } catch (err) {
    logger.error('Failed to disconnect member from voice:', err);
    await interaction.editReply({ components: [textCard('I was unable to disconnect that member.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${EMOJI.HAMMER}  Disconnected ${targetUser} from voice.${reason ? `\n**Reason:** ${reason}` : ''}`;
  await interaction.editReply({ components: [textCard(text, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });
}

async function move(interaction) {
  const resolved = await resolveTarget(interaction, 'move');
  if (!resolved) return;
  const { targetUser, targetMember } = resolved;
  const destination = interaction.options.getChannel('channel', true);
  const reason = interaction.options.getString('reason');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await interaction.reply({ content: 'I need the **Move Members** permission to do that.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await targetMember.voice.setChannel(destination.id, reason ?? undefined);
  } catch (err) {
    logger.error('Failed to move member in voice:', err);
    await interaction.editReply({ components: [textCard('I was unable to move that member. Check my permissions in the destination channel.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = `${EMOJI.APPROVE}  Moved ${targetUser} to ${destination}.${reason ? `\n**Reason:** ${reason}` : ''}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

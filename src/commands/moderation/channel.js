const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  aliases: ['ch'],
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Channel management: lock, unlock, slowmode, bulk-delete.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('lock')
        .setDescription('Block a role from sending messages in a channel.')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to lock (defaults to this one)').setRequired(false))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to block (defaults to @everyone)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unlock')
        .setDescription("Restore a role's ability to send messages in a channel.")
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to unlock (defaults to this one)').setRequired(false))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to restore (defaults to @everyone)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('slowmode')
        .setDescription('Set slowmode on a channel.')
        .addIntegerOption((opt) => opt.setName('seconds').setDescription('Seconds between messages (0 to disable, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21_600))
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to update (defaults to this one)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Bulk delete recent messages from this channel.')
        .addIntegerOption((opt) => opt.setName('amount').setDescription('How many messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption((opt) => opt.setName('user').setDescription('Only delete messages from this user').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'lock') return lock(interaction);
    if (sub === 'unlock') return unlock(interaction);
    if (sub === 'slowmode') return slowmode(interaction);
    return clear(interaction);
  },
};

async function lock(interaction) {
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const role = interaction.options.getRole('role') ?? interaction.guild.roles.everyone;

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
    await interaction.reply({ content: 'That channel type cannot be locked.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: 'I need the **Manage Channels** permission in that channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.permissionOverwrites.edit(role, { SendMessages: false, SendMessagesInThreads: false }, { reason: `Locked by ${interaction.user.tag}` });
  } catch (err) {
    logger.error('Failed to lock channel:', err);
    await interaction.editReply({ components: [textCard('I was unable to update permissions in that channel.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${channel} is now locked for ${role}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function unlock(interaction) {
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const role = interaction.options.getRole('role') ?? interaction.guild.roles.everyone;

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
    await interaction.reply({ content: 'That channel type cannot be unlocked.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: 'I need the **Manage Channels** permission in that channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.permissionOverwrites.edit(role, { SendMessages: null, SendMessagesInThreads: null }, { reason: `Unlocked by ${interaction.user.tag}` });
  } catch (err) {
    logger.error('Failed to unlock channel:', err);
    await interaction.editReply({ components: [textCard('I was unable to update permissions in that channel.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${channel} is now unlocked for ${role}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function slowmode(interaction) {
  const seconds = interaction.options.getInteger('seconds', true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;

  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: 'I need the **Manage Channels** permission in that channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
  } catch (err) {
    logger.error('Failed to set slowmode:', err);
    await interaction.editReply({ components: [textCard('I was unable to update slowmode on that channel.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = seconds === 0 ? `${EMOJI.APPROVE}  Slowmode disabled in ${channel}.` : `${EMOJI.APPROVE}  Slowmode in ${channel} set to **${seconds}s**.`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function clear(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  const user = interaction.options.getUser('user');

  if (!interaction.channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: 'I need the **Manage Messages** permission in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    let toDelete;
    if (user) {
      const recent = await interaction.channel.messages.fetch({ limit: 100 });
      toDelete = recent.filter((m) => m.author.id === user.id).first(amount);
    } else {
      toDelete = await interaction.channel.messages.fetch({ limit: amount });
    }

    const deleted = await interaction.channel.bulkDelete(toDelete, true);
    const text = `${EMOJI.APPROVE}  Deleted **${deleted.size}** message(s)${user ? ` from ${user}` : ''}. Messages older than 14 days can't be bulk-deleted and were skipped.`;
    await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to bulk delete:', err);
    await interaction.editReply({ components: [textCard('I was unable to delete messages in this channel.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

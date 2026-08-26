const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { upsertConfig } = require('../db/report');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');

async function handleModal(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the **Manage Server** permission to configure reports.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channels = interaction.fields.getSelectedChannels('report_config_channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  const channel = channels.first();
  const roles = interaction.fields.getSelectedRoles('report_config_urgent_role');
  const urgentRole = roles?.first() ?? null;
  const anonymousReporting = interaction.fields.getCheckbox('report_config_anonymous') === true;

  if (!channel) {
    await interaction.reply({ content: 'Choose a report channel before submitting.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (urgentRole?.id === interaction.guild.id) {
    await interaction.reply({ content: 'The @everyone role cannot be used as the urgent role.', flags: MessageFlags.Ephemeral });
    return;
  }

  const botMember = interaction.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    await interaction.reply({ content: 'I need View Channel, Send Messages, and Embed Links in the selected report channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, {
    channel_id: channel.id,
    enabled: true,
    anonymous_reporting_enabled: anonymousReporting,
    urgent_role_id: urgentRole?.id ?? null,
  });

  const roleText = urgentRole ? `<@&${urgentRole.id}>` : 'none';
  const content = [
    `${EMOJI.APPROVE} **Report config updated!**`,
    `• Reports go to: <#${channel.id}>`,
    `• Anonymous reporting: **${anonymousReporting ? 'enabled' : 'disabled'}**`,
    `• Urgent role: ${roleText}`,
  ].join('\n');

  await interaction.reply({
    components: [textCard(content, 0xfe6465)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

module.exports = { handleModal };

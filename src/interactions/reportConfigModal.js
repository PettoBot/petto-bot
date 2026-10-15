const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { upsertConfig } = require('../db/report');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const { t, languageOf } = require('../i18n');

async function handleModal(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: t(lang, 'reports.configModal.needsManageServer'), flags: MessageFlags.Ephemeral });
    return;
  }

  const channels = interaction.fields.getSelectedChannels('report_config_channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  const channel = channels.first();
  const roles = interaction.fields.getSelectedRoles('report_config_urgent_role');
  const urgentRole = roles?.first() ?? null;
  const anonymousReporting = interaction.fields.getCheckbox('report_config_anonymous') === true;

  if (!channel) {
    await interaction.reply({ content: t(lang, 'reports.configModal.chooseChannel'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (urgentRole?.id === interaction.guild.id) {
    await interaction.reply({ content: t(lang, 'reports.configModal.everyone'), flags: MessageFlags.Ephemeral });
    return;
  }

  const botMember = interaction.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    await interaction.reply({ content: t(lang, 'reports.configModal.permissions'), flags: MessageFlags.Ephemeral });
    return;
  }

  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, {
    channel_id: channel.id,
    enabled: true,
    anonymous_reporting_enabled: anonymousReporting,
    urgent_role_id: urgentRole?.id ?? null,
  });

  const roleText = urgentRole ? `<@&${urgentRole.id}>` : t(lang, 'reports.config.none');
  const content = [
    t(lang, 'reports.configModal.updated', { emoji: EMOJI.APPROVE }),
    t(lang, 'reports.configModal.channel', { channel: `<#${channel.id}>` }),
    t(lang, anonymousReporting ? 'reports.configModal.anonymousOn' : 'reports.configModal.anonymousOff'),
    t(lang, 'reports.configModal.urgentRole', { role: roleText }),
  ].join('\n');

  await interaction.reply({
    components: [textCard(content, 0xfe6465)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

module.exports = { handleModal };

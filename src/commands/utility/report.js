const {
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/report');
const { buildReportCard, buildReportPayload } = require('../../utils/reportCard');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const REPORT_CONFIG_MODAL_ID = 'petto_report_config_modal';

module.exports = {
  aliases: ['rpt'],
  registerSlash: true,
  hiddenPrefixSubcommands: ['config'],
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a member to the staff team.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('send')
      .setDescription('Report a member for staff to review.')
      .addUserOption((opt) => opt.setName('user').setDescription('The user you are reporting').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Why are you reporting them?').setRequired(true))
      .addBooleanOption((opt) => opt.setName('ping').setDescription('Ask staff to review this urgently.').setRequired(false))
      .addBooleanOption((opt) => opt.setName('anonymous').setDescription('Hide your identity from the report.').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('config')
      .setDescription('(Staff) Configure the report channel and notification options.'))
    .addSubcommand((sub) => sub
      .setName('disable')
      .setDescription('(Staff) Turn off member reports without deleting the configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'config') return showConfig(interaction);
    if (sub === 'disable') return disable(interaction);
    return send(interaction);
  },
};

async function send(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await ensureGuild(interaction.guild.id);
  const reportConfig = await getConfig(interaction.guild.id);

  if (!reportConfig?.enabled || !reportConfig.channel_id) {
    await interaction.editReply({ content: 'Reports are not set up on this server yet.' });
    return;
  }

  const reportedUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const urgent = interaction.options.getBoolean('ping') === true && Boolean(reportConfig.urgent_role_id);
  const anonymous = interaction.options.getBoolean('anonymous') === true && Boolean(reportConfig.anonymous_reporting_enabled);

  if (reportedUser.id === interaction.user.id) {
    await interaction.editReply({ content: 'You cannot report yourself.' });
    return;
  }

  const channel = await interaction.guild.channels.fetch(reportConfig.channel_id).catch(() => null);
  if (!channel) {
    await interaction.editReply({ content: 'The configured report channel no longer exists. Ask staff to run `/report config` again.' });
    return;
  }

  const card = buildReportCard({
    reporter: interaction.user,
    reportedUser,
    reason,
    sourceChannel: interaction.channel,
    anonymous,
    urgent,
    urgentRoleId: reportConfig.urgent_role_id,
  });

  await channel.send(buildReportPayload({ card, urgentRoleId: urgent ? reportConfig.urgent_role_id : null })).catch((err) => {
    logger.error('Failed to deliver report:', err);
    throw err;
  });

  await interaction.editReply({ content: `${EMOJI.APPROVE} Your report was sent to the staff team. Thank you.` });
}

async function showConfig(interaction) {
  if (interaction.rawMessage) {
    await interaction.reply({ content: 'Report configuration is available from the `/report config` interaction only.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the **Manage Server** permission to configure reports.', flags: MessageFlags.Ephemeral });
    return;
  }

  await ensureGuild(interaction.guild.id);
  const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('report_config_channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (reportConfig?.channel_id) channelSelect.setDefaultChannels(reportConfig.channel_id);

  const urgentRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId('report_config_urgent_role')
    .setMinValues(0)
    .setMaxValues(1)
    .setRequired(false);
  if (reportConfig?.urgent_role_id) urgentRoleSelect.setDefaultRoles(reportConfig.urgent_role_id);

  const modal = new ModalBuilder()
    .setCustomId(REPORT_CONFIG_MODAL_ID)
    .setTitle('Report Config')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Report Channel')
        .setDescription('Where user reports will be sent')
        .setChannelSelectMenuComponent(channelSelect),
      new LabelBuilder()
        .setLabel('Anonymous Reporting')
        .setDescription('Adds an opt-out checkbox to reports')
        .setCheckboxComponent(
          new CheckboxBuilder().setCustomId('report_config_anonymous').setDefault(reportConfig?.anonymous_reporting_enabled === true),
        ),
      new LabelBuilder()
        .setLabel('Urgent Role')
        .setDescription('Optional role reporters can choose to ping')
        .setRoleSelectMenuComponent(urgentRoleSelect),
    );

  await interaction.showModal(modal);
}

async function disable(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the **Manage Server** permission to disable reports.', flags: MessageFlags.Ephemeral });
    return;
  }

  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { enabled: false });
  await interaction.reply({
    components: [textCard(`${EMOJI.APPROVE} **Reports disabled.** The saved channel and options are kept; run \`/report config\` to enable them again.`, 0x4b4f59)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

module.exports.REPORT_CONFIG_MODAL_ID = REPORT_CONFIG_MODAL_ID;

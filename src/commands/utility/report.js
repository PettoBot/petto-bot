const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/report');
const { buildReportCard } = require('../../utils/reportCard');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a member to the staff team.')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('send')
        .setDescription('Report a member for staff to review.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user you are reporting').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Why are you reporting them?').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('(Staff) Set the channel reports are sent to.')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Destination channel for reports').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn the report system on/off').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'config') return configure(interaction);
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

  if (reportedUser.id === interaction.user.id) {
    await interaction.editReply({ content: 'You cannot report yourself.' });
    return;
  }

  const channel = await interaction.guild.channels.fetch(reportConfig.channel_id).catch(() => null);
  if (!channel) {
    await interaction.editReply({ content: 'The configured report channel no longer exists. Ask staff to run `!report config` again.' });
    return;
  }

  const card = buildReportCard({ reporter: interaction.user, reportedUser, reason, sourceChannel: interaction.channel });

  await channel.send({ components: [card], flags: MessageFlags.IsComponentsV2 }).catch((err) => {
    logger.error('Failed to deliver report:', err);
    throw err;
  });

  await interaction.editReply({ content: `${EMOJI.APPROVE} Your report was sent to the staff team. Thank you.` });
}

async function configure(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the **Manage Server** permission to configure reports.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const enabled = interaction.options.getBoolean('enabled') ?? true;

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { channel_id: channel.id, enabled });

  const text = `${EMOJI.APPROVE}  Reports ${enabled ? 'enabled' : 'disabled'}. ${enabled ? `New reports (via \`!report send\` and the "Report Message" app command) will be sent to ${channel}.` : ''}`;
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

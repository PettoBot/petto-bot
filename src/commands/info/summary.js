const {
  SlashCommandBuilder, AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const { getActivitySummary } = require('../../db/activityStats');
const detail = require('../../db/activityDetail');
const inviteTracking = require('../../db/inviteTracking');
const { buildSummary, METRICS } = require('../../utils/activitySummary');
const { describeSummary } = require('../../utils/summaryText');
const { buildSummaryCard } = require('../../imgutils/summaryCard');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');

const TITLES = { overview: 'Summary', messages: 'Messages', voice: 'Voice', joins: 'Joins', leaves: 'Leaves', invites: 'Invites', sanctions: 'Sanctions' };
const ACCENTS = { overview: 0xf0a88f, messages: 0xf0a88f, voice: 0x9bd0f5, joins: 0x8fdca8, leaves: 0xf08fa0, invites: 0xc6a8f5, sanctions: 0xf5c26b };

module.exports = {
  aliases: ['digest', 'weekly', 'stats'],
  data: new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Activity of this server: messages, voice, joins, leaves and invites, with the busiest hour.')
    .setDMPermission(false)
    .addStringOption((option) => option.setName('metric').setDescription('What to show (default: everything)').setRequired(false)
      .addChoices(...METRICS.map((metric) => ({ name: TITLES[metric], value: metric }))))
    .addIntegerOption((option) => option.setName('days').setDescription('How many days to include, from 1 to 31').setMinValue(1).setMaxValue(31).setRequired(false)),

  async execute(interaction) {
    const metric = METRICS.includes(interaction.options.getString('metric')) ? interaction.options.getString('metric') : 'overview';
    const days = interaction.options.getInteger('days') ?? 7;
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications });
    const guild = interaction.guild;

    let channelRows;
    try {
      channelRows = await getActivitySummary(guild.id, days);
    } catch {
      await interaction.editReply({ components: [notice('Activity data is not available yet. Make sure the latest database schema is applied.')], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    // The finer counters are newer: a server that has not applied the schema yet still gets the rest.
    const [hourlyRows, flowRows, memberRows, caseRows, inviters] = await Promise.all([
      detail.getHourly(guild.id, days).catch(() => []),
      detail.getFlow(guild.id, days).catch(() => []),
      detail.getMembers(guild.id, days).catch(() => []),
      metric === 'sanctions' || metric === 'overview' ? detail.getCases(guild.id, days).catch(() => []) : [],
      metric === 'invites' || metric === 'overview' ? inviteTracking.getLeaderboard(guild.id, 5).catch(() => []) : [],
    ]);
    const summary = buildSummary({ days, channelRows, hourlyRows, flowRows, memberRows, caseRows, botId: interaction.client.user.id });

    const container = new ContainerBuilder().setAccentColor(ACCENTS[metric] ?? COLORS.DEFAULT);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${TITLES[metric]} · ${guild.name}\n-# Last ${days} ${days === 1 ? 'day' : 'days'}, all times GMT-5 (Colombia)`));

    let files;
    try {
      files = [new AttachmentBuilder(buildSummaryCard({ guildName: guild.name, days, metric, summary }), { name: 'summary.png' })];
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://summary.png')));
    } catch (error) {
      logger.warn({ guildId: guild.id, command: 'summary' }, 'The summary picture could not be drawn; sending the text only.', error);
    }

    const lines = describeSummary(metric, summary, days, inviters, { channelExists: (id) => guild.channels.cache.has(id) });
    if (lines.length) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2, ...(files ? { files } : {}) });
  },
};

const notice = (text) => new ContainerBuilder().setAccentColor(COLORS.DEFAULT).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

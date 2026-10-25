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
const { t, tn, languageOf } = require('../../i18n');

// The names of the metrics for the choices of the builder; the card takes them from the catalogs (`info.summary.title.<metric>`).
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
    .addIntegerOption((option) => option.setName('days').setDescription('How many days to include, from 1 to 365').setMinValue(1).setMaxValue(365).setRequired(false)),

  async execute(interaction) {
    // `,summary 30` or `,summary 30d`: a number where the metric goes is the number of days.
    const asked = String(interaction.options.getString('metric') ?? '').trim().toLowerCase();
    const askedDays = /^\d{1,3}d?$/.test(asked) ? Number.parseInt(asked, 10) : null;
    const metric = METRICS.includes(asked) ? asked : 'overview';
    const days = Math.min(365, Math.max(1, interaction.options.getInteger('days') ?? askedDays ?? 7));
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications });
    const lang = await languageOf(interaction);
    const guild = interaction.guild;

    let channelRows;
    try {
      channelRows = await getActivitySummary(guild.id, days);
    } catch {
      await interaction.editReply({ components: [notice(t(lang, 'info.summary.unavailable'))], flags: MessageFlags.IsComponentsV2 });
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

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(tn(lang, 'info.summary.header', days, { title: t(lang, `info.summary.title.${metric}`), server: guild.name, count: days })));

    let files;
    try {
      files = [new AttachmentBuilder(buildSummaryCard({ guildName: guild.name, days, metric, summary, lang }), { name: 'summary.png' })];
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://summary.png')));
    } catch (error) {
      logger.warn({ guildId: guild.id, command: 'summary' }, 'The summary picture could not be drawn; sending the text only.', error);
    }

    const lines = describeSummary(metric, summary, days, inviters, { channelExists: (id) => guild.channels.cache.has(id), lang });
    if (lines.length) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2, ...(files ? { files } : {}) });
  },
};

const notice = (text) => new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

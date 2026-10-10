const {
  SlashCommandBuilder, AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const { getActivitySummary } = require('../../db/activityStats');
const detail = require('../../db/activityDetail');
const inviteTracking = require('../../db/inviteTracking');
const { buildSummary, bestDay, hourLabel, METRICS } = require('../../utils/activitySummary');
const { buildSummaryCard } = require('../../imgutils/summaryCard');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');

const TITLES = { overview: 'Summary', messages: 'Messages', voice: 'Voice', joins: 'Joins', leaves: 'Leaves', invites: 'Invites' };
const ACCENTS = { overview: 0xf0a88f, messages: 0xf0a88f, voice: 0x9bd0f5, joins: 0x8fdca8, leaves: 0xf08fa0, invites: 0xc6a8f5 };

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
    const [hourlyRows, flowRows, memberRows, inviters] = await Promise.all([
      detail.getHourly(guild.id, days).catch(() => []),
      detail.getFlow(guild.id, days).catch(() => []),
      detail.getMembers(guild.id, days).catch(() => []),
      metric === 'invites' || metric === 'overview' ? inviteTracking.getLeaderboard(guild.id, 5).catch(() => []) : [],
    ]);
    const summary = buildSummary({ days, channelRows, hourlyRows, flowRows, memberRows });

    const container = new ContainerBuilder().setAccentColor(ACCENTS[metric] ?? COLORS.DEFAULT);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${TITLES[metric]} · ${guild.name}\n-# Last ${days} ${days === 1 ? 'day' : 'days'}, all times UTC`));

    let files;
    try {
      files = [new AttachmentBuilder(buildSummaryCard({ guildName: guild.name, days, metric, summary }), { name: 'summary.png' })];
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://summary.png')));
    } catch (error) {
      logger.warn({ guildId: guild.id, command: 'summary' }, 'The summary picture could not be drawn; sending the text only.', error);
    }

    const lines = describe(metric, summary, days, inviters);
    if (lines.length) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2, ...(files ? { files } : {}) });
  },
};

const notice = (text) => new ContainerBuilder().setAccentColor(COLORS.DEFAULT).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
const n = (value) => Number(value).toLocaleString('en-US');
const dayText = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hours = (seconds) => { const m = Math.floor(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const peakLine = (peak, label) => (peak ? `**Most active hour:** ${hourLabel(peak.hour)}–${hourLabel((peak.hour + 1) % 24)} UTC · ${label(peak.value)}` : null);

function describe(metric, summary, days, inviters) {
  const { totals } = summary;
  const channelList = (rows, value) => rows.map((row, i) => `${i + 1}. <#${row.id}> · ${value(row)}`).join('\n');
  const memberList = (rows, value) => rows.map((row, i) => `${i + 1}. <@${row.id}> · ${value(row)}`).join('\n');
  const bestOf = (key, noun) => { const best = bestDay(summary, key); return best ? `**Best day:** ${dayText(best.day)} · ${n(best.value)} ${noun}` : null; };
  const growth = totals.joins - totals.leaves;
  const out = [];

  if (metric === 'voice') {
    out.push(`**Voice time:** ${hours(totals.voiceSeconds)} · ${hours(totals.voiceSeconds / days)} a day`);
    out.push(peakLine(summary.peakHour.voice, (v) => hours(v)));
    if (summary.topChannels.voice.length) out.push(`**Top voice channels**\n${channelList(summary.topChannels.voice, (r) => hours(r.voiceSeconds))}`);
    if (summary.topMembers.voice.length) out.push(`**Top in voice**\n${memberList(summary.topMembers.voice, (r) => hours(r.voiceSeconds))}`);
  } else if (['joins', 'leaves', 'invites'].includes(metric)) {
    out.push(`**Joined:** ${n(totals.joins)} · **Left:** ${n(totals.leaves)} · **Growth:** ${growth >= 0 ? '+' : ''}${n(growth)}`);
    out.push(`**Through invites:** ${n(totals.invited)}${totals.joins ? ` (${Math.round((totals.invited / totals.joins) * 100)}% of the joins)` : ''}`);
    out.push(bestOf(metric === 'invites' ? 'invited' : metric, metric === 'leaves' ? 'left' : 'joined'));
    if (metric === 'invites' && inviters.length) out.push(`**Top inviters**\n${inviters.map((r, i) => `${i + 1}. <@${r.inviter_id}> · ${n(r.net)}`).join('\n')}`);
    if (!totals.joins && !totals.leaves) out.push('-# Joins and leaves are counted from the moment this was added.');
  } else {
    if (metric === 'messages') out.push(`**Messages:** ${n(totals.messages)} · ${n(Math.round(totals.messages / days))} a day · **Active members:** ${n(totals.activeMembers)}`);
    else out.push(`**Growth:** ${growth >= 0 ? '+' : ''}${n(growth)} members (${n(totals.joins)} joined, ${n(totals.leaves)} left) · **Reactions:** ${n(totals.reactions)}`);
    out.push(peakLine(summary.peakHour.messages, (v) => `${n(v)} messages`));
    out.push(bestOf('messages', 'messages'));
    if (summary.topChannels.messages.length) out.push(`**Top channels**\n${channelList(summary.topChannels.messages, (r) => `${n(r.messages)} messages`)}`);
    if (summary.topMembers.messages.length) out.push(`**Top members**\n${memberList(summary.topMembers.messages, (r) => `${n(r.messages)} messages`)}`);
    if (metric === 'overview' && inviters.length) out.push(`**Top inviters**\n${inviters.slice(0, 3).map((r, i) => `${i + 1}. <@${r.inviter_id}> · ${n(r.net)}`).join('\n')}`);
  }
  return out.filter(Boolean);
}

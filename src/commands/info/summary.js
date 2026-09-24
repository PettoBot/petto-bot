const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getActivitySummary } = require('../../db/activityStats');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { buildActivitySummaryCard } = require('../../imgutils/activitySummaryCard');

module.exports = {
  aliases: ['digest', 'weekly'],
  data: new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Show a weekly activity summary for this server.')
    .setDMPermission(false)
    .addIntegerOption((option) => option.setName('days').setDescription('How many days to include, from 1 to 31').setMinValue(1).setMaxValue(31).setRequired(false)),

  async execute(interaction) {
    const days = interaction.options.getInteger('days') ?? 7;
    await interaction.deferReply({ flags: MessageFlags.SuppressNotifications });

    let rows;
    try {
      rows = await getActivitySummary(interaction.guild.id, days);
    } catch {
      await interaction.editReply({ content: 'Activity data is not available yet. Make sure the latest database schema is applied.' });
      return;
    }

    const totals = rows.reduce((acc, row) => ({
      messages: acc.messages + Number(row.messages ?? 0),
      reactions: acc.reactions + Number(row.reactions ?? 0),
      voiceSeconds: acc.voiceSeconds + Number(row.voice_seconds ?? 0),
    }), { messages: 0, reactions: 0, voiceSeconds: 0 });

    const byChannel = new Map();
    for (const row of rows) {
      const current = byChannel.get(row.channel_id) ?? { messages: 0, reactions: 0 };
      current.messages += Number(row.messages ?? 0);
      current.reactions += Number(row.reactions ?? 0);
      byChannel.set(row.channel_id, current);
    }

    const topChannels = [...byChannel.entries()]
      .sort(([, a], [, b]) => (b.messages + b.reactions) - (a.messages + a.reactions))
      .slice(0, 5)
      .map(([channelId, data], index) => `${index + 1}. <#${channelId}> · ${data.messages.toLocaleString()} messages`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle(`Weekly summary · ${interaction.guild.name}`)
      .setDescription(`Activity from the last **${days} day${days === 1 ? '' : 's'}**.`)
      .addFields(
        { name: 'Messages', value: totals.messages.toLocaleString(), inline: true },
        { name: 'Reactions', value: totals.reactions.toLocaleString(), inline: true },
        { name: 'Voice time', value: formatDuration(totals.voiceSeconds), inline: true },
        { name: 'Most active channels', value: topChannels || 'No activity tracked yet.', inline: false },
      )
      .setFooter({ text: 'Petto only uses aggregated activity counters for this summary.' });

    let files;
    try {
      const chart = buildActivitySummaryCard({
        guildName: interaction.guild.name,
        days,
        rows,
        totals,
        activeChannels: byChannel.size,
      });
      const attachment = new AttachmentBuilder(chart, { name: 'activity-summary.png' });
      embed.setImage('attachment://activity-summary.png');
      files = [attachment];
    } catch (error) {
      logger.warn({ guildId: interaction.guild.id, command: 'summary', source: 'summary' }, 'Activity summary chart could not be rendered; sending the text summary only.', error);
    }

    await interaction.editReply({ embeds: [embed], ...(files ? { files } : {}) });
  },
};

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/levelConfig');
const levelUsersDb = require('../../db/levelUsers');
const { totalXpForLevel, xpNeeded } = require('../../utils/levelCurve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { getVoiceConfig } = require('../../utils/levelSource');

const PER_PAGE = 10;
const COLOR = 0x4b4f59;
const TIMEOUT_MS = 120_000;

function navRow(page, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('top_prev').setEmoji(EMOJI.PREV).setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 1),
    new ButtonBuilder().setCustomId('top_page').setEmoji(EMOJI.PAGES).setLabel(`${page} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('top_next').setEmoji(EMOJI.NEXT).setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === totalPages),
    new ButtonBuilder().setCustomId('top_close').setEmoji(EMOJI.CLOSE).setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

async function buildPage(guild, page, config, source = 'messages') {
  const offset = (page - 1) * PER_PAGE;
  const rows = source === 'voice'
    ? await levelUsersDb.getVoiceLeaderboardPage(guild.id, { offset, limit: PER_PAGE })
    : await levelUsersDb.getLeaderboardPage(guild.id, { offset, limit: PER_PAGE });

  const lines = rows.map((row, i) => {
    const num = String(offset + i + 1).padStart(2, '0');
    const member = guild.members.cache.get(row.user_id);
    const name = member?.displayName ?? `<@${row.user_id}>`;
    const xp = source === 'voice' ? Number(row.voice_xp ?? 0) : Number(row.xp ?? 0);
    const level = source === 'voice' ? Number(row.voice_level ?? 0) : Number(row.level ?? 0);
    const currXp = xp - totalXpForLevel(level, config);
    const needed = xpNeeded(level, config);
    return `**\`${num}.\`** ${name}\n**»** Lv. **${level}** (${currXp.toLocaleString()}/${needed.toLocaleString()} XP)`;
  });

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(source === 'voice' ? `${guild.name} • Voice leaderboard` : `${guild.name} • Leaderboard`)
    .setThumbnail(guild.iconURL())
    .setDescription(lines.join('\n\n') || 'No data.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Server XP leaderboard.')
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false).setMinValue(1))
    .addStringOption((o) => o.setName('type').setDescription('Which leveling system to view').addChoices({ name: 'Messages', value: 'messages' }, { name: 'Voice', value: 'voice' }).setRequired(false)),
  aliases: ['leaderboard', 'lb', 'ranking'],

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    const source = interaction.options.getString('type') ?? 'messages';
    const sourceConfig = source === 'voice' ? getVoiceConfig(config ?? {}) : config;
    if (!sourceConfig?.enabled) {
      await interaction.reply({ components: [textCard(`${source === 'voice' ? 'Voice' : 'Message'} leveling is not enabled in this server.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    await interaction.deferReply();
    await interaction.guild.members.fetch().catch(() => {});

    const total = source === 'voice' ? await levelUsersDb.countVoiceRanked(interaction.guild.id) : await levelUsersDb.countRanked(interaction.guild.id);
    if (!total) {
      await interaction.editReply({ components: [textCard('Nobody has ranked yet.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    let page = Math.min(Math.max(1, interaction.options.getInteger('page') ?? 1), totalPages);

    const embed = await buildPage(interaction.guild, page, sourceConfig, source);
    embed.setFooter({ text: `${total} member(s) · Page ${page}/${totalPages}` });

    if (totalPages === 1) {
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const msg = await interaction.editReply({ embeds: [embed], components: [navRow(page, totalPages)] });
    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

    collector.on('collect', async (i) => {
      if (i.customId === 'top_close') {
        collector.stop('closed');
        await i.update({ components: [navRow(page, totalPages, true)] });
        return;
      }

      if (i.customId === 'top_prev') page = Math.max(1, page - 1);
      if (i.customId === 'top_next') page = Math.min(totalPages, page + 1);

      const nextEmbed = await buildPage(interaction.guild, page, sourceConfig, source);
      nextEmbed.setFooter({ text: `${total} member(s) · Page ${page}/${totalPages}` });
      await i.update({ embeds: [nextEmbed], components: [navRow(page, totalPages)] });
    });

    collector.on('end', (_c, reason) => {
      if (reason === 'closed') return;
      msg.edit({ components: [navRow(page, totalPages, true)] }).catch(() => {});
    });
  },
};

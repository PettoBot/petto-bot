const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/levelConfig');
const levelUsersDb = require('../../db/levelUsers');
const { totalXpForLevel, xpNeeded } = require('../../utils/levelCurve');
const { buildProgressBar } = require('../../utils/levelProgressBar');
const { textCard } = require('../../utils/caseCard');

const COLOR = 0x4b4f59;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your level/XP rank, or someone else\'s.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to check (default: you)').setRequired(false)),
  aliases: ['nivel', 'lvl'],

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;

    const config = await getConfig(interaction.guild.id);
    if (!config?.enabled) {
      await interaction.reply({ components: [textCard('The leveling system is not enabled in this server.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const data = await levelUsersDb.getUser(interaction.guild.id, target.id);
    if (!data || data.xp <= 0) {
      await interaction.reply({ components: [textCard(`${target} doesn't have any XP recorded yet.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    await interaction.deferReply();

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    const rank = await levelUsersDb.getRank(interaction.guild.id, data.xp);
    const total = await levelUsersDb.countRanked(interaction.guild.id);

    const currLevelXp = Math.max(0, data.xp - totalXpForLevel(data.level, config));
    const needed = xpNeeded(data.level, config);
    const progress = needed > 0 ? Math.min(100, Math.round((currLevelXp / needed) * 100)) : 0;

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setAuthor({ name: targetMember?.displayName ?? target.username, iconURL: (targetMember ?? target).displayAvatarURL({ size: 256, extension: 'png' }) })
      .setThumbnail((targetMember ?? target).displayAvatarURL({ size: 256, extension: 'png' }))
      .addFields(
        { name: '**Level**', value: `${data.level}`, inline: true },
        { name: '**Server Rank**', value: `#${rank} out of ${total}`, inline: true },
        { name: '**Experience**', value: `${currLevelXp.toLocaleString()}/${needed.toLocaleString()} XP`, inline: true },
        { name: `**Progress (${progress}%)**`, value: buildProgressBar(progress), inline: true },
      )
      .setFooter({ text: `Total Experience: ${data.xp.toLocaleString()} • ${dateStr}` });

    await interaction.editReply({ embeds: [embed] });
  },
};

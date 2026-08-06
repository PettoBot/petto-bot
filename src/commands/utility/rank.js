const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/levelConfig');
const levelUsersDb = require('../../db/levelUsers');
const { totalXpForLevel, xpNeeded } = require('../../utils/levelCurve');
const { buildProgressBar } = require('../../utils/levelProgressBar');
const { textCard } = require('../../utils/caseCard');
const { getVoiceConfig } = require('../../utils/levelSource');

const COLOR = 0x4b4f59;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your level/XP rank, or someone else\'s.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to check (default: you)').setRequired(false))
    .addStringOption((o) => o.setName('type').setDescription('Which leveling system to view').addChoices({ name: 'Messages', value: 'messages' }, { name: 'Voice', value: 'voice' }).setRequired(false)),
  aliases: ['nivel', 'lvl'],

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const source = interaction.options.getString('type') ?? 'messages';

    const config = await getConfig(interaction.guild.id);
    const sourceConfig = source === 'voice' ? getVoiceConfig(config ?? {}) : config;
    if (!sourceConfig?.enabled) {
      await interaction.reply({ components: [textCard(`${source === 'voice' ? 'Voice' : 'Message'} leveling is not enabled in this server.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const data = await levelUsersDb.getUser(interaction.guild.id, target.id);
    const xp = source === 'voice' ? Number(data?.voice_xp ?? 0) : Number(data?.xp ?? 0);
    const level = source === 'voice' ? Number(data?.voice_level ?? 0) : Number(data?.level ?? 0);
    if (!data || xp <= 0) {
      await interaction.reply({ components: [textCard(`${target} doesn't have any ${source === 'voice' ? 'voice XP' : 'XP'} recorded yet.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    await interaction.deferReply();

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    const rank = source === 'voice' ? await levelUsersDb.getVoiceRank(interaction.guild.id, xp) : await levelUsersDb.getRank(interaction.guild.id, xp);
    const total = source === 'voice' ? await levelUsersDb.countVoiceRanked(interaction.guild.id) : await levelUsersDb.countRanked(interaction.guild.id);

    const currLevelXp = Math.max(0, xp - totalXpForLevel(level, sourceConfig));
    const needed = xpNeeded(level, sourceConfig);
    const progress = needed > 0 ? Math.min(100, Math.round((currLevelXp / needed) * 100)) : 0;

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(source === 'voice' ? 'Voice rank' : 'Rank')
      .setAuthor({ name: targetMember?.displayName ?? target.username, iconURL: (targetMember ?? target).displayAvatarURL({ size: 256, extension: 'png' }) })
      .setThumbnail((targetMember ?? target).displayAvatarURL({ size: 256, extension: 'png' }))
      .addFields(
        { name: '**Level**', value: `${level}`, inline: true },
        { name: '**Server Rank**', value: `#${rank} out of ${total}`, inline: true },
        { name: '**Experience**', value: `${currLevelXp.toLocaleString()}/${needed.toLocaleString()} XP`, inline: true },
        { name: `**Progress (${progress}%)**`, value: buildProgressBar(progress), inline: true },
      )
      .setFooter({ text: `${source === 'voice' ? 'Total voice XP' : 'Total Experience'}: ${xp.toLocaleString()} • ${dateStr}` });

    await interaction.editReply({ embeds: [embed] });
  },
};

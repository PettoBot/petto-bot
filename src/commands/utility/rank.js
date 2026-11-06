const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/levelConfig');
const levelUsersDb = require('../../db/levelUsers');
const { buildLevelData } = require('../../utils/levelData');
const { buildRankReply } = require('../../utils/rankView');
const { boostFor } = require('../../utils/voteBoost');
const { textCard } = require('../../utils/caseCard');
const { getVoiceConfig } = require('../../utils/levelSource');
const { t, languageOf } = require('../../i18n');

module.exports = {
  // A prefix command: its slash entry is inside `/levels` or `/bot` (utils/umbrella.js).
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your level/XP rank, or someone else\'s.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to check (default: you)').setRequired(false))
    .addStringOption((o) => o.setName('type').setDescription('Which leveling system to view').addChoices({ name: 'Messages', value: 'messages' }, { name: 'Voice', value: 'voice' }).setRequired(false)),
  aliases: ['nivel', 'lvl'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const target = interaction.options.getUser('user') ?? interaction.user;
    const source = interaction.options.getString('type') ?? 'messages';
    const voice = source === 'voice';

    const config = await getConfig(interaction.guild.id);
    const sourceConfig = voice ? getVoiceConfig(config ?? {}) : config;
    if (!sourceConfig?.enabled) {
      await interaction.reply({ components: [textCard(t(lang, voice ? 'leveling.notEnabled.voice' : 'leveling.notEnabled.messages'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const userData = await levelUsersDb.getUser(interaction.guild.id, target.id);
    const xp = Number(voice ? userData?.voice_xp ?? 0 : userData?.xp ?? 0);
    if (!userData || xp <= 0) {
      await interaction.reply({ components: [textCard(t(lang, voice ? 'leveling.rank.noVoiceXp' : 'leveling.rank.noXp', { user: `${target}` }))], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    await interaction.deferReply();

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const [rank, total, voteBoost] = await Promise.all([
      voice ? levelUsersDb.getVoiceRank(interaction.guild.id, xp) : levelUsersDb.getRank(interaction.guild.id, xp),
      voice ? levelUsersDb.countVoiceRanked(interaction.guild.id) : levelUsersDb.countRanked(interaction.guild.id),
      boostFor(config, target.id),
    ]);
    const data = buildLevelData({ config: sourceConfig, userData, source, rank, total, voteBoost, voteBoostEnabled: config.vote_boost_enabled !== false });
    const shown = member ?? target;

    const reply = await buildRankReply({
      style: config.rank_style ?? 'card',
      ctx: { guild: interaction.guild, member, user: target, channel: interaction.channel, levelData: data },
      data,
      name: member?.displayName ?? target.username,
      avatarUrl: shown.displayAvatarURL({ size: 256, extension: 'png' }),
      cardName: config.rank_card ?? null,
      source,
      botId: interaction.client.user.id,
      own: target.id === interaction.user.id,
      lang,
    });
    await interaction.editReply(reply);
  },
};

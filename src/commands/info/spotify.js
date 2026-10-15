const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { buildSpCard } = require('../../imgutils/spCard');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

module.exports = {
  aliases: ['sp'],
  data: new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('See what a member is listening to on Spotify right now.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show what someone is listening to on Spotify.')
        .addUserOption((o) => o.setName('user').setDescription('Member to check (defaults to you)').setRequired(false)),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply({ components: [textCard(t(lang, 'info.notMember'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const activity = target.presence?.activities?.find((a) => a.name === 'Spotify' && a.syncId);
    if (!activity) {
      await interaction.editReply({ components: [textCard(t(lang, 'info.spotify.none', { name: target.displayName }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const start = activity.timestamps?.start?.getTime?.() ?? Date.now();
    const end = activity.timestamps?.end?.getTime?.() ?? Date.now();
    const elapsed = fmtTime(Date.now() - start);
    const total = fmtTime(end - start);
    const ratio = Math.min((Date.now() - start) / (end - start), 1);
    const albumArt = activity.assets?.largeImage ? `https://i.scdn.co/image/${activity.assets.largeImage.replace('spotify:', '')}` : null;

    try {
      const buf = await buildSpCard({
        albumArtUrl: albumArt,
        songName: activity.details ?? t(lang, 'info.unknown'),
        artistName: activity.state?.replace(/;/g, ',') ?? t(lang, 'info.unknown'),
        elapsed,
        total,
        progressRatio: ratio,
      });
      await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'sp.png' })] });
    } catch (err) {
      logger.error('[spotify] card error:', err);
      await interaction.editReply({ components: [textCard(t(lang, 'info.spotify.cardError', { emoji: EMOJI.DENY }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    }
  },
};

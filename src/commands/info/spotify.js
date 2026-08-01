const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { buildSpCard } = require('../../imgutils/spCard');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('Spotify commands.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show what someone is listening to on Spotify.')
        .addUserOption((o) => o.setName('user').setDescription('Member to check (defaults to you)').setRequired(false)),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const target = interaction.options.getMember('user') ?? interaction.member;

    const activity = target.presence?.activities?.find((a) => a.name === 'Spotify' && a.syncId);
    if (!activity) {
      await interaction.editReply({ components: [textCard(`**${target.displayName}** is not listening to Spotify right now.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
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
        songName: activity.details ?? 'Unknown',
        artistName: activity.state?.replace(/;/g, ',') ?? 'Unknown',
        elapsed,
        total,
        progressRatio: ratio,
      });
      await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'sp.png' })] });
    } catch (err) {
      logger.error('[spotify] card error:', err);
      await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  Could not generate card.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    }
  },
};

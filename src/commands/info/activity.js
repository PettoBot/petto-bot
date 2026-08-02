const { SlashCommandBuilder, AttachmentBuilder, ActivityType, MessageFlags } = require('discord.js');
const { buildAcCard } = require('../../imgutils/acCard');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  aliases: ['ac'],
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Activity commands.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription("Show a member's current Discord activity.")
        .addUserOption((o) => o.setName('user').setDescription('Member to check (defaults to you)').setRequired(false)),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply({ components: [textCard('That user is not a member of this server.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const activity = target.presence?.activities?.find(
      (a) =>
        a.name !== 'Spotify' &&
        (a.type === ActivityType.Playing ||
          a.type === ActivityType.Watching ||
          a.type === ActivityType.Listening ||
          a.type === ActivityType.Competing ||
          a.type === ActivityType.Streaming),
    );

    if (!activity) {
      await interaction.editReply({ components: [textCard(`**${target.displayName}** has no active activity right now.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    try {
      const buf = await buildAcCard({ activity, member: target });
      await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'ac.png' })] });
    } catch (err) {
      logger.error('[activity] card error:', err);
      await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  Could not generate activity card.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    }
  },
};

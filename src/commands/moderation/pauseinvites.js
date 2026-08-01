const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild, updateGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { parseDuration, formatDuration } = require('../../utils/duration');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pauseinvites')
    .setDescription('Delete all server invites and block new ones for a set duration.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('duration').setDescription('e.g. 1h, 30m, 1d').setRequired(true)),

  async execute(interaction) {
    const durationMs = parseDuration(interaction.options.getString('duration', true));
    if (!durationMs) {
      await interaction.reply({ content: 'Invalid duration. Use something like `1h`, `30m`, or `1d`.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'I need the **Manage Server** permission.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);

    const until = new Date(Date.now() + durationMs);
    await updateGuild(interaction.guild.id, { invites_paused_until: until.toISOString() });

    let deleted = 0;
    try {
      const invites = await interaction.guild.invites.fetch();
      for (const invite of invites.values()) {
        await invite.delete(`Invites paused by ${interaction.user.tag}`).catch(() => {});
        deleted += 1;
      }
    } catch (err) {
      logger.warn('pauseinvites: failed to fetch/delete invites:', err.message);
    }

    await interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE}  Deleted **${deleted}** invite(s). New invites will be auto-deleted for **${formatDuration(durationMs)}**.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

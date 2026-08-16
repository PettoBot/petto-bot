const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { isPettoOperator } = require('../../utils/autoModControl');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const SNOWFLAKE_RE = /^\d{15,25}$/;

/**
 * Private support control. It is deliberately prefix-only and hidden from !help:
 * Petto may leave a guild it is currently in, but it cannot remove another bot
 * from a guild where Petto is not installed.
 */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('leaveguild')
    .setDescription('Private support control: make Petto leave one of its servers.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('guild_id')
      .setDescription('The Discord server ID Petto should leave.')
      .setRequired(true)),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) {
      return reply(interaction, `${EMOJI.DENY} This private support control is not available to this account.`, 0xfe6465);
    }

    const supportGuildId = await resolveSupportGuildId(interaction.client);
    if (!supportGuildId || interaction.guildId !== supportGuildId) {
      return reply(interaction, `${EMOJI.DENY} This control can only be used in Petto's official support server.`, 0xfe6465);
    }

    const targetId = interaction.options.getString('guild_id', true).trim();
    if (!SNOWFLAKE_RE.test(targetId)) {
      return reply(interaction, `${EMOJI.WARNING} Use a valid Discord server ID. Example: \`!leaveguild 123456789012345678\``, 0xfed53c);
    }

    if (targetId === supportGuildId) {
      return reply(interaction, `${EMOJI.WARNING} Petto cannot leave the official support server with this command.`, 0xfed53c);
    }

    const target = interaction.client.guilds.cache.get(targetId)
      ?? await interaction.client.guilds.fetch(targetId).catch(() => null);
    if (!target) {
      return reply(interaction, `${EMOJI.WARNING} Petto is not currently in a server with ID \`${targetId}\`.`, 0xfed53c);
    }

    const targetName = target.name || 'Unknown server';
    await interaction.reply({
      components: [textCard(`${EMOJI.WARNING} Leaving **${targetName}** (\`${targetId}\`)…`, 0xfed53c)],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      await target.leave();
      logger.info(`Support leave control completed: guild=${targetId} name=${targetName} requested_by=${interaction.user.id}`);
      await interaction.editReply({
        components: [textCard(`${EMOJI.APPROVE} Petto left **${targetName}** (\`${targetId}\`).`, 0xa5ea7a)],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      logger.error(`Support leave control failed for guild ${targetId}:`, error);
      await interaction.editReply({
        components: [textCard(`${EMOJI.DENY} Petto could not leave **${targetName}** right now.`, 0xfe6465)],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  },
};

async function resolveSupportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}

async function reply(interaction, content, color) {
  return interaction.reply({
    components: [textCard(content, color)],
    flags: MessageFlags.IsComponentsV2,
  });
}

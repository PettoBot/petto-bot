const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const { isPettoOperator } = require('../utils/autoModControl');
const logger = require('../utils/logger');

const PREPARE_PREFIX = 'gops_leave_prepare:';
const CONFIRM_PREFIX = 'gops_leave_confirm:';
const CANCEL_PREFIX = 'gops_leave_cancel:';
const SNOWFLAKE_RE = /^\d{15,25}$/;

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    const customId = interaction.customId;
    if (!customId.startsWith(PREPARE_PREFIX) && !customId.startsWith(CONFIRM_PREFIX) && !customId.startsWith(CANCEL_PREFIX)) return;

    if (!isPettoOperator(interaction.user?.id)) {
      await interaction.reply({ content: 'This private support control is not available to this account.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const supportGuildId = await resolveSupportGuildId(interaction.client);
    if (!supportGuildId || interaction.guildId !== supportGuildId) {
      await interaction.reply({ content: 'This control can only be used in Petto\'s official support server.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const prefix = customId.startsWith(PREPARE_PREFIX) ? PREPARE_PREFIX : customId.startsWith(CONFIRM_PREFIX) ? CONFIRM_PREFIX : CANCEL_PREFIX;
    const guildId = customId.slice(prefix.length);
    if (!SNOWFLAKE_RE.test(guildId) || guildId === supportGuildId) {
      await interaction.reply({ content: 'Invalid or protected server target.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (prefix === CANCEL_PREFIX) {
      await interaction.update({ content: 'Leave action cancelled.', components: [] }).catch(() => {});
      return;
    }

    const target = interaction.client.guilds.cache.get(guildId)
      ?? await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!target) {
      await interaction.reply({ content: 'Petto is no longer in that server.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (prefix === PREPARE_PREFIX) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX}${guildId}`).setLabel('Confirm leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${CANCEL_PREFIX}${guildId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        content: `Confirm that Petto should leave **${target.name}** (\`${guildId}\`). This action immediately disconnects Petto from that server.`,
        components: [row],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const targetName = target.name || 'Unknown server';
    try {
      await target.leave();
      logger.info({ guildId, action: 'guildops-leave', userId: interaction.user.id }, `Petto left ${targetName} after team confirmation.`);
      await interaction.update({ content: `Petto left **${targetName}** (\`${guildId}\`).`, components: [] }).catch(() => {});
    } catch (error) {
      logger.error({ guildId, action: 'guildops-leave', userId: interaction.user.id }, 'GuildOps leave button failed:', error);
      await interaction.update({ content: `Petto could not leave **${targetName}** right now.`, components: [] }).catch(() => {});
    }
  },
};

async function resolveSupportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}

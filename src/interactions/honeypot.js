const { MessageFlags } = require('discord.js');
const { getHoneypot } = require('../db/honeypot');
const {
  HONEYPOT_COUNT_BUTTON_ID,
  buildHoneypotStatsPanel,
  buildHoneypotImageAttachment,
} = require('../utils/honeypotPanel');

async function handleButton(interaction) {
  const config = await getHoneypot(interaction.guildId, interaction.channelId);

  if (!config || (config.panel_message_id && config.panel_message_id !== interaction.message.id)) {
    await interaction.reply({
      content: 'This honeypot is no longer configured.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.reply({
    components: [buildHoneypotStatsPanel({
      punishment: config.punishment,
      caught_count: config.caught_count,
      channelId: interaction.channelId,
    })],
    files: [buildHoneypotImageAttachment()],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

module.exports = { HONEYPOT_COUNT_BUTTON_ID, handleButton };

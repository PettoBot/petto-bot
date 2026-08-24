const { MessageFlags } = require('discord.js');
const { getHoneypot } = require('../db/honeypot');
const { HONEYPOT_COUNT_BUTTON_ID } = require('../utils/honeypotPanel');
const { punishmentText } = require('../utils/honeypotPanel');

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

  const count = Number(config.trigger_count) || 0;
  await interaction.reply({
    content: `This honeypot has triggered **${count}** time${count === 1 ? '' : 's'}. The configured action is **${punishmentText(config.punishment)}**.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

module.exports = { HONEYPOT_COUNT_BUTTON_ID, handleButton };

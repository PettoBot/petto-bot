const { MessageFlags } = require('discord.js');
const { getHoneypot } = require('../db/honeypot');
const {
  HONEYPOT_COUNT_BUTTON_ID,
  buildHoneypotStatsPanel,
  buildHoneypotImageAttachment,
} = require('../utils/honeypotPanel');
const { t, languageOf } = require('../i18n');

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const config = await getHoneypot(interaction.guildId, interaction.channelId);

  if (!config || (config.panel_message_id && config.panel_message_id !== interaction.message.id)) {
    await interaction.reply({
      content: t(lang, 'security.honeypot.button.gone'),
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
      lang,
    })],
    files: [buildHoneypotImageAttachment()],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

module.exports = { HONEYPOT_COUNT_BUTTON_ID, handleButton };

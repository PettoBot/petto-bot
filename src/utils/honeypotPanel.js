const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');

const HONEYPOT_IMAGE_URL = 'https://honeypot.riskymh.dev/honeypot.png';
const HONEYPOT_COUNT_BUTTON_ID = 'moderated_count_button';

function punishmentText(punishment) {
  if (punishment === 'ban') return 'a ban';
  if (punishment === 'kick') return 'a kick';
  return 'a softban';
}

function buildHoneypotPanel({ punishment = 'softban', triggerCount, trigger_count } = {}) {
  // Database rows use snake_case; accepting camelCase as well keeps this builder
  // convenient for tests and other Discord-facing callers.
  const count = Math.max(0, Number(triggerCount ?? trigger_count) || 0);
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots. Any messages sent here will result in **${punishmentText(punishment)}**.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(HONEYPOT_IMAGE_URL));

  const countButton = new ButtonBuilder()
    .setCustomId(HONEYPOT_COUNT_BUTTON_ID)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(`Kicks: ${count}`)
    .setEmoji('🍯');

  return new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(countButton));
}

module.exports = {
  HONEYPOT_IMAGE_URL,
  HONEYPOT_COUNT_BUTTON_ID,
  punishmentText,
  buildHoneypotPanel,
};

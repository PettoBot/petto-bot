const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const path = require('node:path');
const { t, currentLanguage } = require('../i18n');

const HONEYPOT_IMAGE_PATH = path.join(__dirname, '..', 'assets', 'petto-honeypot.png');
const HONEYPOT_IMAGE_URL = 'attachment://petto-honeypot.png';
const HONEYPOT_COUNT_BUTTON_ID = 'moderated_count_button';
const HONEYPOT_BUTTON_EMOJI = '<:petto_honeypot:1541493688054841405>';

function punishmentText(punishment, lang = currentLanguage()) {
  if (punishment === 'ban') return t(lang, 'security.honeypot.punishment.ban');
  if (punishment === 'kick') return t(lang, 'security.honeypot.punishment.kick');
  return t(lang, 'security.honeypot.punishment.softban');
}

function buildHoneypotPanel({ punishment = 'softban', caughtCount, caught_count, lang = currentLanguage() } = {}) {
  // Database rows use snake_case; accepting camelCase as well keeps this builder
  // convenient for tests and other Discord-facing callers.
  const count = Math.max(0, Number(caughtCount ?? caught_count) || 0);
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t(lang, 'security.honeypot.panel.warning', { punishment: punishmentText(punishment, lang) })),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(HONEYPOT_IMAGE_URL));

  const countButton = new ButtonBuilder()
    .setCustomId(HONEYPOT_COUNT_BUTTON_ID)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(t(lang, 'security.honeypot.panel.count.button', { count }))
    .setEmoji(HONEYPOT_BUTTON_EMOJI);

  return new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(countButton));
}

function buildHoneypotStatsPanel({ punishment = 'softban', caughtCount, caught_count, channelId, lang = currentLanguage() } = {}) {
  const count = Math.max(0, Number(caughtCount ?? caught_count) || 0);
  const vars = { emoji: HONEYPOT_BUTTON_EMOJI, count, punishment: punishmentText(punishment, lang) };
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(channelId
        ? t(lang, 'security.honeypot.stats.withChannel', { ...vars, channel: `<#${channelId}>` })
        : t(lang, 'security.honeypot.stats.text', vars)),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(HONEYPOT_IMAGE_URL));

  return new ContainerBuilder()
    .setAccentColor(0xd99a3d)
    .addSectionComponents(section);
}

function buildHoneypotImageAttachment() {
  return new AttachmentBuilder(HONEYPOT_IMAGE_PATH, { name: 'petto-honeypot.png' });
}

module.exports = {
  HONEYPOT_IMAGE_PATH,
  HONEYPOT_IMAGE_URL,
  HONEYPOT_COUNT_BUTTON_ID,
  HONEYPOT_BUTTON_EMOJI,
  punishmentText,
  buildHoneypotPanel,
  buildHoneypotStatsPanel,
  buildHoneypotImageAttachment,
};

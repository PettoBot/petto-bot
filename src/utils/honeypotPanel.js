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

const HONEYPOT_IMAGE_PATH = path.join(__dirname, '..', 'assets', 'petto-honeypot.png');
const HONEYPOT_IMAGE_URL = 'attachment://petto-honeypot.png';
const HONEYPOT_COUNT_BUTTON_ID = 'moderated_count_button';
const HONEYPOT_BUTTON_EMOJI = '<:petto_honeypot:1541493688054841405>';

function punishmentText(punishment) {
  if (punishment === 'ban') return 'a ban';
  if (punishment === 'kick') return 'a kick';
  return 'a softban';
}

function buildHoneypotPanel({ punishment = 'softban', caughtCount, caught_count } = {}) {
  // Database rows use snake_case; accepting camelCase as well keeps this builder
  // convenient for tests and other Discord-facing callers.
  const count = Math.max(0, Number(caughtCount ?? caught_count) || 0);
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots. Any messages sent here will result in **${punishmentText(punishment)}**. Each member is actioned once while they remain in the server; later messages are removed without creating duplicate cases.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(HONEYPOT_IMAGE_URL));

  const countButton = new ButtonBuilder()
    .setCustomId(HONEYPOT_COUNT_BUTTON_ID)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(`Members caught: ${count}`)
    .setEmoji(HONEYPOT_BUTTON_EMOJI);

  return new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(countButton));
}

function buildHoneypotStatsPanel({ punishment = 'softban', caughtCount, caught_count, channelId } = {}) {
  const count = Math.max(0, Number(caughtCount ?? caught_count) || 0);
  const channelLine = channelId ? `**Channel:** <#${channelId}>\n` : '';
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## <:petto_honeypot:1541493688054841405> Honeypot Statistics\n\n${channelLine}**Members caught:** ${count}\n**Configured action:** ${punishmentText(punishment)}\n\nEach member is actioned once while they remain in the server. Later messages are deleted without duplicate cases or repeated actions.`,
      ),
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

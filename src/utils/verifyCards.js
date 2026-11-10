// The pieces that the cards of the verification share (the panel, the DMs and the answers): the ids of the buttons, the button of the letters, the picture of the server.
// No database here, so a DM can be built without the rest of the check.
const { ButtonBuilder, ButtonStyle, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');
const { baseUrl } = require('./verifyLink');
const { t, currentLanguage } = require('../i18n');

const PREFIX = 'vfy';
const ids = { start: (guildId) => `${PREFIX}:start:${guildId}`, type: (guildId) => `${PREFIX}:type:${guildId}`, answer: (guildId) => `${PREFIX}:answer:${guildId}`, link: (guildId) => `${PREFIX}:link:${guildId}`, again: (guildId) => `${PREFIX}:again:${guildId}` };
/** The button of the verification DM that starts the letters check. */
function startButton(guildId, lang = currentLanguage()) {
  return new ButtonBuilder().setCustomId(ids.start(guildId)).setLabel(t(lang, 'verify.letters.start.button')).setEmoji(EMOJI.SAFETY).setStyle(ButtonStyle.Primary);
}


/** The picture of the server for the cards (its icon), or Petto's when it has none, or null. */
function serverPicture(guild) {
  const icon = typeof guild?.iconURL === 'function' ? guild.iconURL({ size: 128, extension: 'png' }) : null;
  if (icon) return icon;
  const base = baseUrl();
  return base ? `${base}/assets/favicon.png` : null;
}

/** Text with the picture of the server beside it when there is one. */
function withPicture(container, text, picture) {
  const display = new TextDisplayBuilder().setContent(text);
  if (picture) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(display).setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
  else container.addTextDisplayComponents(display);
  return container;
}

module.exports = { PREFIX, ids, startButton, serverPicture, withPicture };

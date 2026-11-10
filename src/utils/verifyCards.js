// The pieces that the cards of the verification share (the panel, the DMs and the answers): the ids of the buttons, the button of the letters, the picture of the cards (the avatar of Petto in the server).
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


/**
 * The picture on the cards: the avatar Petto has in this server (the one the server gave it, when it has one of its own), else the avatar Petto uses everywhere, else the
 * icon of the website when neither can be read. Null when there is none of them.
 */
function serverPicture(guild) {
  const options = { extension: 'png', size: 128 };
  const avatar = guild?.members?.me?.displayAvatarURL?.(options) ?? guild?.client?.user?.displayAvatarURL?.(options);
  if (avatar) return avatar;
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

// The panel of `!stats privacy`: what is counted about a person, whether they are counted, and the buttons to stop being counted, to be counted again
// and to delete what was counted about them. It is Components V2; the buttons belong to the person who asked (their id is in the button).
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { EMOJI } = require('./emojis');
const { t } = require('../i18n');

const PREFIX = 'stats';
const PRIVACY_URL = 'https://petto.sbs/privacy#statistics';

/** `done` is a line about what was just done (shown on top), or null. */
function buildPrivacyPanel({ userId, optedOut, done = null, lang }) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'info.stats.privacy.title', { emoji: EMOJI.SAFETY })))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'info.stats.privacy.body', { url: PRIVACY_URL })))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([done, t(lang, optedOut ? 'info.stats.privacy.notCounted' : 'info.stats.privacy.counted')].filter(Boolean).join('\n\n')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'info.stats.privacy.hint')));
  const row = new ActionRowBuilder().addComponents(
    optedOut
      ? new ButtonBuilder().setCustomId(`${PREFIX}:optin:${userId}`).setLabel(t(lang, 'info.stats.privacy.optIn.button')).setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId(`${PREFIX}:optout:${userId}`).setLabel(t(lang, 'info.stats.privacy.optOut.button')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:delete:${userId}`).setLabel(t(lang, 'info.stats.privacy.delete.button')).setStyle(ButtonStyle.Secondary),
  );
  return { components: [container, row] };
}

module.exports = { PREFIX, PRIVACY_URL, buildPrivacyPanel };

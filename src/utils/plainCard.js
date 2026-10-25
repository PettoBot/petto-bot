// The default look of the new messages: a Components V2 container with the text in it. It has no color, except green (it went well), red
// (refused) or the yellow of the warnings; any other color is ignored.
const { ContainerBuilder, MessageFlags } = require('discord.js');
const { addBlocks } = require('./cardBlocks');
const { COLORS, semanticColor, colorFromText } = require('./colors');

const TONES = { green: 0xa5ea7a, red: 0xff6b6b, yellow: COLORS.YELLOW, orange: COLORS.YELLOW, pink: null };

/** `{ components, flags }` for one text in a container. Extra send options (files, allowedMentions) are added by the caller. */
function plainCard(text, color = null) {
  const container = addBlocks(new ContainerBuilder(), String(text).slice(0, 3900));
  const accent = semanticColor(color) ?? colorFromText(String(text));
  if (accent !== null) container.setAccentColor(accent);
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { plainCard, TONES };

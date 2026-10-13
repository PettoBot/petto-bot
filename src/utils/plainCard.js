// The default look of the new messages: a Components V2 container with the text in it. The color is one of the warm Petto tones (green, red,
// yellow, orange, pink), never purple or blue; without one the container is grey.
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const TONES = { green: 0xa5ea7a, red: 0xff6b6b, yellow: 0xffd563, orange: 0xffb86c, pink: 0xf78fb3 };

/** `{ components, flags }` for one text in a container. Extra send options (files, allowedMentions) are added by the caller. */
function plainCard(text, color = null) {
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(String(text).slice(0, 3900)));
  if (Number.isInteger(color)) container.setAccentColor(color);
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { plainCard, TONES };

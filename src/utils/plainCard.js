// The default look of the new messages: a Components V2 container with the text in it and no accent color (a grey one, like the
// verification). Servers that want their own look pick a saved design instead.
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

/** `{ components, flags }` for one text in a container without color. Extra send options (files, allowedMentions) are added by the caller. */
function plainCard(text) {
  return {
    components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(String(text).slice(0, 3900)))],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = { plainCard };

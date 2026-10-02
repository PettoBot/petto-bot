// Turns a saved embed template into a message for one event of the bot. The events that let a server choose their own
// message (a sanction, a starboard repost, a giveaway announcement, verification) share this: a template that is
// missing, empty or broken gives null, and the caller sends its usual message instead, so a bad template never stops
// what the bot was doing.
const { getTemplate } = require('../db/embedTemplates');
const { build, hasSendablePayload } = require('./embedBuilder');
const logger = require('./logger');

/** `{ content, embeds, components, files }` ready to send, or null when there is no usable template. */
async function templatePayload(guildId, name, ctx) {
  if (!guildId || !name) return null;
  try {
    const doc = await getTemplate(guildId, name);
    if (!doc?.data) return null;
    const payload = await build(doc.data, ctx);
    if (!hasSendablePayload(payload)) return null;
    return {
      content: payload.content || undefined,
      embeds: payload.embeds ?? [],
      components: payload.components ?? [],
      files: payload.files ?? [],
    };
  } catch (error) {
    logger.warn({ guildId, action: 'template-message' }, `The template ${name} could not be built: ${error.message}`);
    return null;
  }
}

module.exports = { templatePayload };

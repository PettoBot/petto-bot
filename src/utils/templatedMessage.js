// Turns a saved embed template into a message for one event of the bot. The events that let a server choose their own
// message (a sanction, a starboard repost, a giveaway announcement, verification) share this: a template that is
// missing, empty or broken gives null, and the caller sends its usual message instead, so a bad template never stops
// what the bot was doing.
const { getTemplate } = require('../db/embedTemplates');
const { build, hasSendablePayload } = require('./embedBuilder');
const { extractReactRepliesFromTemplate, uniqueReactions } = require('./messageFlags');
const logger = require('./logger');

/** `{ content, embeds, components, files, reactions }` (and `flags` for a Components V2 message) ready to send, or null when there is no usable template. `reactions` is not part of what Discord takes: take it out before sending. */
async function templatePayload(guildId, name, ctx, options = {}) {
  if (!guildId || !name) return null;
  try {
    const doc = await getTemplate(guildId, name);
    if (!doc?.data) return null;
    // The reactions the embed asks for (its `reactions` list and any {reactreply:emoji}) come out as `reactions`, to be put on the
    // message once it is sent; the senders that can do it call applyReactReplies.
    const reactions = [];
    const data = extractReactRepliesFromTemplate(doc.data, reactions);
    const payload = await build(data, { ...ctx, allowV2: true, v2Extras: options.v2Extras });
    if (!hasSendablePayload(payload)) return null;
    return {
      reactions: uniqueReactions(reactions),
      content: payload.content || undefined,
      embeds: payload.embeds ?? [],
      components: payload.components ?? [],
      files: payload.files ?? [],
      ...(payload.flags ? { flags: payload.flags } : {}),
    };
  } catch (error) {
    logger.warn({ guildId, action: 'template-message' }, `The template ${name} could not be built: ${error.message}`);
    return null;
  }
}

module.exports = { templatePayload };

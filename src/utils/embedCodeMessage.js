// Turns an embed code (`{embed}$v{description: ...}`) into the message to send, for the places that take a code
// directly: autoresponders and `!editembed`.
const { parseEmbedScript, toTemplateData } = require('./embedScript');
const { build, hasSendablePayload, formatEmbedError } = require('./embedBuilder');

/**
 * Reads and builds a code for the member and server in `ctx`. Returns `{ payload, warnings }`. `payload` is null when the
 * code has nothing to show, and `error` says when Discord would refuse what the code builds. It never throws.
 */
async function payloadFromCode(code, ctx) {
  const parsed = parseEmbedScript(code);
  const warnings = parsed.warnings;
  if (!parsed.embeds.length && !parsed.content && !parsed.buttons.length) return { payload: null, warnings };
  try {
    const { data } = toTemplateData(parsed);
    const payload = await build(data, ctx);
    if (!hasSendablePayload(payload)) return { payload: null, warnings };
    return { payload, warnings };
  } catch (err) {
    return { payload: null, warnings, error: formatEmbedError(err) };
  }
}

module.exports = { payloadFromCode };

// Turns an embed code (`{embed}$v{description: ...}`) into the message to send, for the places that take a code
// directly: autoresponders and `!editembed`.
const { parseEmbedScript, toTemplateData } = require('./embedScript');
const { build, hasSendablePayload, formatEmbedError } = require('./embedBuilder');
const { currentLanguage } = require('../i18n');

/**
 * Reads and builds a code for the member and server in `ctx`. Returns `{ payload, warnings }`. `payload` is null when the
 * code has nothing to show, and `error` says when Discord would refuse what the code builds. It never throws. The warnings
 * and the error are in `lang` (the language of `ctx.lang`, or of the command or event that is running).
 */
async function payloadFromCode(code, ctx, lang = ctx?.lang ?? currentLanguage()) {
  const parsed = parseEmbedScript(code, lang);
  const warnings = parsed.warnings;
  if (!parsed.embeds.length && !parsed.content && !parsed.buttons.length) return { payload: null, warnings };
  try {
    const { data } = toTemplateData(parsed);
    const payload = await build(data, ctx);
    if (!hasSendablePayload(payload)) return { payload: null, warnings };
    return { payload, warnings };
  } catch (err) {
    return { payload: null, warnings, error: formatEmbedError(err, lang) };
  }
}

module.exports = { payloadFromCode };

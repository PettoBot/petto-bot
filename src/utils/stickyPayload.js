// What a sticky message sends: its saved embed (a classic or a Components V2 design) when it has one, and its text when
// that embed is missing or broken. Nothing at all when there is neither, so an empty sticky never posts an empty message.
const { templatePayload } = require('./templatedMessage');

/** `sticky` is a row of sticky_messages; `source` has the `guild`, `channel` and `member`/`author` the variables are read from. */
async function stickyPayload(sticky, source) {
  if (sticky.embed_template) {
    const payload = await templatePayload(source.guild.id, sticky.embed_template, { guild: source.guild, channel: source.channel, member: source.member ?? null, user: source.author ?? source.user ?? null });
    if (payload) return payload;
  }
  return sticky.content ? { content: sticky.content } : null;
}

module.exports = { stickyPayload };

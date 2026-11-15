// What a sticky message sends: its saved embed (a classic or a Components V2 design) when it has one, and its text when
// that embed is missing or broken. Nothing at all when there is neither, so an empty sticky never posts an empty message.
// And sending it now: when a sticky is set (the command, or the dashboard through `petto:sticky`) it is posted at once, without
// waiting for somebody to write in the channel.
const { templatePayload } = require('./templatedMessage');
const logger = require('./logger');

const SNOWFLAKE = /^\d{15,25}$/;

/** `sticky` is a row of sticky_messages; `source` has the `guild`, `channel` and `member`/`author` the variables are read from. */
async function stickyPayload(sticky, source) {
  if (sticky.embed_template) {
    const payload = await templatePayload(source.guild.id, sticky.embed_template, { guild: source.guild, channel: source.channel, member: source.member ?? null, user: source.author ?? source.user ?? null });
    if (payload) return payload;
  }
  return sticky.content ? { content: sticky.content } : null;
}

/**
 * Posts the sticky of a channel now: the old message (`oldMessageId`, the one the row remembers by default) goes, the new one is sent and
 * remembered, and its reactions are added. `row` is a row of sticky_messages; the person of the variables is `member`/`user` (the bot when
 * the dashboard asked). Answers the message sent, or null when there was nothing to send or Discord refused.
 */
async function sendStickyNow(row, { guild, channel, member = null, user = null, oldMessageId = row.message_id }) {
  const stickyDb = require('../db/stickyMessages');
  if (oldMessageId) {
    const old = await channel.messages.fetch(oldMessageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const payload = await stickyPayload(row, { guild, channel, member, user });
  const sent = !payload ? null : await channel.send(payload).catch((err) => {
    logger.error('Failed to post sticky message:', err);
    return null;
  });
  if (sent) {
    await stickyDb.setMessageId(guild.id, channel.id, sent.id);
    if (payload?.reactions?.length) await require('./messageFlags').applyReactReplies(sent, payload.reactions);
  }
  return sent;
}

/**
 * One message of `petto:sticky` (`{ "guildId": "...", "channelId": "..." }`, published by the dashboard after it saves a sticky): the sticky
 * is posted now. Only the process that has the server does it, and once for a burst (a double click, two processes). `deps` is for the checks.
 */
async function handleStickyNow(client, raw, deps = {}) {
  let message;
  try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return false; }
  const guildId = String(message?.guildId ?? '');
  const channelId = String(message?.channelId ?? '');
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) return false;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  const claim = deps.claim ?? require('./redis').claim;
  if (await claim(`sticky-now:${guildId}:${channelId}`, 5_000)) return false;
  const stickyDb = deps.stickyDb ?? require('../db/stickyMessages');
  (deps.invalidate ?? require('./cacheInvalidation').invalidate)('sticky_messages', guildId);
  const row = await stickyDb.getSticky(guildId, channelId);
  if (!row) return false;
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return false;
  const me = guild.members?.me ?? null;
  if (me && channel.permissionsFor && !channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) return false;
  return Boolean(await (deps.send ?? sendStickyNow)(row, { guild, channel, member: me, user: client.user ?? null }));
}

/** Listens on `petto:sticky`. False without Redis (the sticky then comes back with the next message, as it always did). */
function startStickyNowListener(client) {
  return require('./redis').subscribe('sticky', (raw) => {
    handleStickyNow(client, raw).catch((err) => logger.warn(`Sticky: could not post it now: ${err?.message ?? err}`));
  });
}

module.exports = { stickyPayload, sendStickyNow, handleStickyNow, startStickyNowListener };

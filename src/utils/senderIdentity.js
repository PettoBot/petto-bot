// Sends a message with the name and picture a server chose for that kind of message (see db/senderIdentities.js). It goes through
// a webhook that Petto makes in the channel; if the server chose nothing, or a webhook cannot be used (no Manage Webhooks, a
// channel that cannot have one), the message is sent the normal way, so choosing a look never stops a message.
const { ChannelType } = require('discord.js');
const identities = require('../db/senderIdentities');
const logger = require('./logger');

const WEBHOOK_NAME = 'Petto messages';
const webhooks = new Map();
const failed = new Map();
const RETRY_AFTER_MS = 10 * 60_000;

const isHttps = (value) => { try { return new URL(String(value)).protocol === 'https:'; } catch { return false; } };

/** The webhook Petto uses in a channel (a thread uses the one of its channel), made when there is none. Null when it cannot. */
async function webhookFor(channel, client) {
  const base = channel.isThread?.() ? channel.parent : channel;
  if (!base || ![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(base.type)) return null;
  const known = webhooks.get(base.id);
  if (known) return known;
  if (Date.now() - (failed.get(base.id) ?? 0) < RETRY_AFTER_MS) return null;
  try {
    const own = [...(await base.fetchWebhooks()).values()].find((hook) => hook.owner?.id === client.user.id && hook.name === WEBHOOK_NAME && hook.token);
    const hook = own ?? await base.createWebhook({ name: WEBHOOK_NAME, avatar: client.user.displayAvatarURL({ extension: 'png', size: 256 }), reason: 'Messages with their own name and picture' });
    webhooks.set(base.id, hook);
    return hook;
  } catch (error) {
    failed.set(base.id, Date.now());
    logger.warn({ guildId: base.guild?.id, action: 'sender-identity' }, `A webhook could not be made in ${base.id}: ${error.message}`);
    return null;
  }
}

/**
 * Sends `payload` in `channel` as the look the server chose for `feature`. Returns the message that was sent, or null.
 * `deps` lets a test replace the database and the webhook lookup.
 */
async function sendAs(channel, feature, payload, deps = {}) {
  const store = deps.identities ?? identities;
  let identity = null;
  try { identity = channel.guild ? await store.get(channel.guild.id, feature) : null; } catch { identity = null; }
  const name = String(identity?.name ?? '').trim().slice(0, 80);
  const avatar = isHttps(identity?.avatar_url) ? identity.avatar_url : null;
  if (name || avatar) {
    const hook = await (deps.webhookFor ?? webhookFor)(channel, channel.client);
    if (hook) {
      try {
        const options = { ...payload, username: name || undefined, avatarURL: avatar ?? undefined };
        if (payload.components?.length) options.withComponents = true;
        if (channel.isThread?.()) options.threadId = channel.id;
        return await hook.send(options);
      } catch (error) {
        // A deleted webhook is made again the next time; whatever else went wrong, the message is still sent the normal way.
        webhooks.delete(channel.isThread?.() ? channel.parentId : channel.id);
        logger.warn({ guildId: channel.guild?.id, action: 'sender-identity' }, `A message with its own look could not be sent (${feature}): ${error.message}`);
      }
    }
  }
  return channel.send(payload);
}

module.exports = { sendAs, webhookFor, WEBHOOK_NAME };

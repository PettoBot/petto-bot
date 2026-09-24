const { Events, PermissionFlagsBits } = require('discord.js');
const { getConfig, listSilentChannelsCached } = require('../db/automod');
const { findBannedWord, isExcessiveCaps, hasMassMentions, hasUnauthorizedInvite, isRepeatFlood } = require('../utils/automodChecks');
const { applyAutomodAction } = require('../utils/automodAction');
const { handleHoneypotMessage } = require('../utils/honeypot');
const logger = require('../utils/logger');
const { extractUrls } = require('../utils/safeBrowsing');
const { findKnownMalicious } = require('../db/maliciousLinks');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return;

    // Honeypots intentionally inspect bot messages too: compromised accounts and spam bots
    // are the bait's primary target. Petto's own messages are excluded by the helper.
    try {
      if (await handleHoneypotMessage(message)) return;
    } catch (err) {
      logger.error(`Honeypot scan failed for message ${message.id} in guild ${message.guild.id}:`, err);
    }

    if (message.author.bot || !message.member) return;

    // Global known-malicious URL guard. This performs DB/cache lookups only — it
    // never calls Google Safe Browsing for ordinary messages. Staff are checked
    // too because a compromised staff account should not bypass link blocking.
    try {
      const urls = extractUrls(message.content);
      if (urls.length) {
        const hits = await findKnownMalicious(urls);
        if (hits.length) {
          const deleted = await message.delete().then(() => true).catch((err) => {
            logger.warn(`Could not delete malicious-link message ${message.id}: ${err.message}`);
            return false;
          });

          const notice = await message.channel.send({
            content: deleted
              ? `<@${message.author.id}> your message was removed because it contained a URL in Petto's malicious-link database.`
              : `<@${message.author.id}> that message contains a URL Petto has identified as malicious. Do not open it.`,
            allowedMentions: { users: [message.author.id] },
          }).catch(() => null);

          if (notice) setTimeout(() => notice.delete().catch(() => {}), 12_000);
          logger.warn(`Blocked known malicious URL in guild=${message.guild.id} channel=${message.channel.id} user=${message.author.id}`);
          return;
        }
      }
    } catch (err) {
      // Fail open on DB/cache errors: ordinary messages must never fall back to
      // an external Safe Browsing request per URL.
      logger.error(`Malicious-link DB scan failed for message ${message.id}:`, err);
    }

    // Staff are exempt from configurable automod rules below, but not from the
    // known-malicious URL guard above.
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    try {
      const config = await getConfig(message.guild.id);

      // Immune roles bypass every automod check below, including silent channels.
      if (config?.immune_role_ids?.some((id) => message.member.roles.cache.has(id))) return;

      const silentChannels = await listSilentChannelsCached(message.guild.id);
      const silent = silentChannels.find((row) => row.channel_id === message.channel.id) ?? null;
      if (silent) {
        await applyAutomodAction(message, { violationType: 'silent-channel', reason: 'This channel does not allow messages.', action: silent.action === 'mute' ? 'tempmute' : silent.action });
        return;
      }

      if (!config) return;

      if (config.word_filter_enabled) {
        const hit = findBannedWord(message.content, config.banned_words);
        if (hit) {
          const action = config.word_filter_action === 'mute' ? 'tempmute' : config.word_filter_action;
          await applyAutomodAction(message, { violationType: 'word-filter', reason: `Used a filtered word (\`${hit}\`).`, action });
          return;
        }
      }

      if (config.anti_spam_enabled) {
        if (isRepeatFlood(message.guild.id, message.author.id, message.content)) {
          await applyAutomodAction(message, { violationType: 'repeat-flood', reason: 'Sent the same message repeatedly in a short time.', action: 'tempmute' });
          return;
        }

        if (hasMassMentions(message, config.max_mentions)) {
          await applyAutomodAction(message, { violationType: 'mass-mentions', reason: `Mentioned more than ${config.max_mentions} users/roles in one message.`, action: 'warn' });
          return;
        }

        if (hasUnauthorizedInvite(message.content, config.allowed_invite_codes)) {
          await applyAutomodAction(message, { violationType: 'unauthorized-invite', reason: 'Posted a Discord invite that is not on this server\'s allow-list.', action: 'warn' });
          return;
        }

        if (isExcessiveCaps(message.content)) {
          await applyAutomodAction(message, { violationType: 'excessive-caps', reason: 'Message was mostly uppercase.', action: 'warn' });
        }
      }
    } catch (err) {
      logger.error(`Automod scan failed for message ${message.id} in guild ${message.guild.id}:`, err);
    }
  },
};

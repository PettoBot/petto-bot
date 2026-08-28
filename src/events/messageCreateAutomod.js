const { Events, PermissionFlagsBits } = require('discord.js');
const { getConfig, listSilentChannelsCached } = require('../db/automod');
const { findBannedWord, isExcessiveCaps, hasMassMentions, hasUnauthorizedInvite, isRepeatFlood } = require('../utils/automodChecks');
const { applyAutomodAction } = require('../utils/automodAction');
const { handleHoneypotMessage } = require('../utils/honeypot');
const logger = require('../utils/logger');

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
    // Staff are exempt — automod shouldn't punish the people configuring it.
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

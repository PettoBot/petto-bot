const { Events, PermissionFlagsBits } = require('discord.js');
const { getConfig, getSilentChannel } = require('../db/automod');
const { findBannedWord, isExcessiveCaps, hasMassMentions, hasUnauthorizedInvite, isRepeatFlood } = require('../utils/automodChecks');
const { applyAutomodAction } = require('../utils/automodAction');
const { checkFirstMessageUrl } = require('../utils/automodLinkScan');
const { isSafeBrowsingConfigured } = require('../utils/safeBrowsing');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.member) return;
    // Staff are exempt — automod shouldn't punish the people configuring it.
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    try {
      const config = await getConfig(message.guild.id);

      // Immune roles bypass every automod check below, including silent channels.
      if (config?.immune_role_ids?.some((id) => message.member.roles.cache.has(id))) return;

      const silent = await getSilentChannel(message.guild.id, message.channel.id);
      if (silent) {
        await applyAutomodAction(message, { violationType: 'silent-channel', reason: 'This channel does not allow messages.', action: silent.action === 'mute' ? 'tempmute' : silent.action });
        return;
      }

      if (!config) return;

      if (config.link_scan_enabled && isSafeBrowsingConfigured()) {
        const scan = await checkFirstMessageUrl(message.content).catch((err) => {
          logger.warn(`Automod link scan failed for message ${message.id}:`, err.message);
          return null;
        });
        if (scan?.threats?.length) {
          await applyAutomodAction(message, {
            violationType: 'malicious-link',
            reason: `Google Safe Browsing flagged \`${scan.url}\` (${scan.threats.join(', ')}).`,
            action: config.link_scan_action === 'mute' ? 'tempmute' : config.link_scan_action ?? 'delete',
          });
          return;
        }
      }

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

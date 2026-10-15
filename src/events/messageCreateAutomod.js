const { Events, PermissionFlagsBits } = require('discord.js');
const { sendAs } = require('../utils/senderIdentity');
const { getConfig, listSilentChannelsCached } = require('../db/automod');
const { listCompiled: listAutomodRules, countHit } = require('../db/automodRules');
const { findBannedWord, isExcessiveCaps, hasMassMentions, hasUnauthorizedInvite, isRepeatFlood, isTooLong } = require('../utils/automodChecks');
const { applyAutomodAction } = require('../utils/automodAction');
const { handleHoneypotMessage } = require('../utils/honeypot');
const logger = require('../utils/logger');
const { extractUrls } = require('../utils/safeBrowsing');
const { findKnownMalicious } = require('../db/maliciousLinks');
const { filterName } = require('../utils/nativeAutomod');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return;
    const lang = currentLanguage();

    // Honeypots intentionally inspect bot messages too: compromised accounts and spam bots
    // are the bait's primary target. Petto's own messages are excluded by the helper.
    try {
      if (await handleHoneypotMessage(message)) return;
    } catch (err) {
      logger.error(`Honeypot scan failed for message ${message.id} in guild ${message.guild.id}:`, err);
    }

    if (message.author.bot || !message.member) return;

    // Global known-malicious URL guard. This performs DB/cache lookups only — it
    // never calls an external reputation service for ordinary messages. Staff are checked
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

          const notice = await sendAs(message.channel, 'automod', {
            content: t(lang, deleted ? 'security.malicious.removed' : 'security.malicious.kept', { user: `<@${message.author.id}>` }),
            allowedMentions: { users: [message.author.id] },
          }).catch(() => null);

          if (notice) setTimeout(() => notice.delete().catch(() => {}), 12_000);
          logger.warn(`Blocked known malicious URL in guild=${message.guild.id} channel=${message.channel.id} user=${message.author.id}`);
          return;
        }
      }
    } catch (err) {
      // Fail open on DB/cache errors: ordinary messages must never fall back to
    // an external reputation request per URL.
      logger.error(`Malicious-link DB scan failed for message ${message.id}:`, err);
    }

    // Staff are exempt from configurable automod rules below, but not from the
    // known-malicious URL guard above.
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    try {
      const config = await getConfig(message.guild.id);

      // Immune roles bypass every automod check below, including silent channels.
      if (config?.immune_role_ids?.some((id) => message.member.roles.cache.has(id))) return;

      if (config?.exempt_channel_ids?.includes(message.channel.id) || (message.channel.parentId && config?.exempt_channel_ids?.includes(message.channel.parentId))) return;

      const silentChannels = await listSilentChannelsCached(message.guild.id);
      const silent = silentChannels.find((row) => row.channel_id === message.channel.id) ?? null;
      if (silent) {
        await applyAutomodAction(message, { violationType: 'silent-channel', reason: t(lang, 'security.automod.why.silentChannel'), action: silent.action === 'mute' ? 'tempmute' : silent.action });
        return;
      }

      if (config?.word_filter_enabled) {
        const hit = findBannedWord(message.content, config.banned_words);
        if (hit) {
          const action = config.word_filter_action === 'mute' ? 'tempmute' : config.word_filter_action;
          await applyAutomodAction(message, { violationType: 'word-filter', reason: t(lang, 'security.automod.why.wordFilter', { word: hit }), action });
          return;
        }
      }

      // Filters made from templates (links, invites, emojis...): the first one that matches answers.
      const rules = await listAutomodRules(message.guild.id);
      for (const rule of rules) {
        if (rule.exempt_channel_ids?.includes(message.channel.id) || rule.exempt_channel_ids?.includes(message.channel.parentId)) continue;
        if (rule.exempt_role_ids?.some((id) => message.member.roles.cache.has(id))) continue;
        if (!rule.regexes.some((re) => re.test(message.content))) continue;
        countHit(message.guild.id, rule);
        await applyAutomodAction(message, {
          violationType: `filter-${rule.template}`,
          reason: t(lang, 'security.automod.why.filter', { name: filterName(rule, lang) }),
          action: rule.action === 'mute' ? 'tempmute' : rule.action,
          durationMs: rule.action === 'mute' ? rule.mute_minutes * 60_000 : undefined,
        });
        return;
      }

      if (config?.anti_spam_enabled) {
        if (config.spam_repeat !== false && isRepeatFlood(message.guild.id, message.author.id, message.content, { threshold: config.repeat_threshold ?? 3, windowMs: (config.repeat_window_seconds ?? 10) * 1000 })) {
          await applyAutomodAction(message, { violationType: 'repeat-flood', reason: t(lang, 'security.automod.why.repeatFlood'), action: 'tempmute' });
          return;
        }

        if (config.spam_mentions !== false && hasMassMentions(message, config.max_mentions)) {
          await applyAutomodAction(message, { violationType: 'mass-mentions', reason: t(lang, 'security.automod.why.massMentions', { max: config.max_mentions }), action: 'warn' });
          return;
        }

        if (config.spam_invites !== false && hasUnauthorizedInvite(message.content, config.allowed_invite_codes)) {
          await applyAutomodAction(message, { violationType: 'unauthorized-invite', reason: t(lang, 'security.automod.why.unauthorizedInvite'), action: 'warn' });
          return;
        }

        if (config.spam_caps !== false && isExcessiveCaps(message.content, { minLength: config.caps_min_length ?? 12, threshold: (config.caps_percent ?? 70) / 100 })) {
          await applyAutomodAction(message, { violationType: 'excessive-caps', reason: t(lang, 'security.automod.why.excessiveCaps'), action: 'warn' });
          return;
        }
      }

      // Long messages and walls of lines are only taken down, nobody is punished for them.
      const tooLong = isTooLong(message.content, { maxLength: config?.max_message_length ?? 0, maxLines: config?.max_lines ?? 0 });
      if (tooLong) {
        await applyAutomodAction(message, { violationType: 'long-message', reason: t(lang, tooLong === 'lines' ? 'security.automod.why.tooManyLines' : 'security.automod.why.tooLong'), action: 'delete' });
      }
    } catch (err) {
      logger.error(`Automod scan failed for message ${message.id} in guild ${message.guild.id}:`, err);
    }
  },
};

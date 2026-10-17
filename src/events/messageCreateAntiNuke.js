const { Events, MessageFlags, WebhookType } = require('discord.js');
const { track, ruleEnabled } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// Who owns a webhook is asked once and kept a while: a flood is many messages from the same webhook.
const WEBHOOK_TTL_MS = 10 * 60_000;
const webhookInfo = new Map(); // webhookId -> { at, info }

async function webhookOf(message) {
  const cached = webhookInfo.get(message.webhookId);
  if (cached && Date.now() - cached.at < WEBHOOK_TTL_MS) return cached.info;
  const webhook = await message.fetchWebhook().catch(() => null);
  const info = webhook ? { id: webhook.id, name: webhook.name, type: webhook.type, applicationId: webhook.applicationId ?? null, owner: webhook.owner ?? null } : null;
  if (webhookInfo.size > 5000) webhookInfo.clear();
  webhookInfo.set(message.webhookId, { at: Date.now(), info });
  return info;
}

/**
 * Two protections read messages:
 * - Anti Mass Mention: @everyone or @here that really pinged (Discord only sets it when the author may), again and again by
 *   the same account. The pings are deleted when it answers.
 * - Anti Webhook Spam: a webhook made by a person flooding messages. The webhook is deleted and the person who made it answers.
 *   Webhooks of bots and apps (PluralKit, interactions, followed announcement channels) are left alone.
 */
module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.system) return;
    const lang = currentLanguage();
    try {
      if (message.webhookId) {
        if (message.interactionMetadata || message.interaction || message.applicationId || message.flags?.has?.(MessageFlags.IsCrosspost)) return;
        if (!(await ruleEnabled(message.guild.id, 'webhook_spam'))) return;
        const webhook = await webhookOf(message);
        if (!webhook || webhook.type !== WebhookType.Incoming || webhook.applicationId || webhook.owner?.bot) return;
        const executor = webhook.owner ? webhook.owner : { id: webhook.id, username: webhook.name, bot: false, webhookOnly: true };
        await track(message.client, message.guild, {
          rule: 'webhook_spam',
          executor,
          actionLabel: t(lang, 'security.antinuke.detail.webhookSpam', { name: webhook.name ?? webhook.id }),
          inline: [{ kind: 'delete_webhook', id: webhook.id, name: webhook.name }],
        });
        return;
      }
      // Bots that announce with @everyone are not punished here (a bot added by a raider is the job of Anti Bots).
      if (!message.mentions?.everyone || !message.author || message.author.bot) return;
      await track(message.client, message.guild, {
        rule: 'mention_everyone',
        executor: message.author,
        actionLabel: t(lang, 'security.antinuke.detail.mentionEveryone'),
        inline: [{ kind: 'delete_message', channelId: message.channelId, id: message.id }],
      });
    } catch (err) {
      logger.error('Anti-nuke message tracking failed:', err);
    }
  },
};

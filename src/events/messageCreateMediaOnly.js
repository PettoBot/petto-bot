// Media channels: a message that does not fit the channel's rule (see utils/mediaOnly.js) is deleted, and the person is told why in a notice that
// deletes itself. Members with Manage Messages, and the roles the server chose, are never touched.
const { Events, PermissionFlagsBits } = require('discord.js');
const db = require('../db/mediaOnly');
const { evaluate } = require('../utils/mediaOnly');
const { plainCard } = require('../utils/plainCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { t, guildLanguage } = require('../i18n');

const NOTICE_SECONDS = 7;
// One notice per person and channel every few seconds, so a burst of messages does not fill the channel with notices.
const noticed = new Map();
const NOTICE_GAP_MS = 8000;

function bypasses(message, rule) {
  const member = message.member;
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  return (rule.bypass_role_ids ?? []).some((id) => member.roles?.cache?.has(id));
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author?.bot || message.system || message.webhookId) return;
    let rules;
    try { rules = await db.getRules(message.guild.id); } catch { return; }
    if (!rules.size) return;
    // A thread follows the rule of the channel it belongs to.
    const rule = rules.get(message.channelId) ?? (message.channel?.isThread?.() ? rules.get(message.channel.parentId) : null);
    if (!rule || (!rule.attachments_enabled && !rule.links_enabled)) return;
    if (bypasses(message, rule)) return;
    const result = evaluate({ content: message.content, attachments: message.attachments?.values?.() ?? [] }, rule);
    if (result.ok) return;
    try {
      await message.delete();
    } catch (error) {
      logger.warn(`[media-only] could not delete a message in ${message.channelId}: ${error.message}`);
      return;
    }
    if (!rule.notice) return;
    const key = `${message.channelId}:${message.author.id}`;
    const now = Date.now();
    if ((noticed.get(key) ?? 0) + NOTICE_GAP_MS > now) return;
    noticed.set(key, now);
    if (noticed.size > 2000) noticed.delete(noticed.keys().next().value);
    const lang = await guildLanguage(message.guild.id).catch(() => 'en');
    const sent = await message.channel.send({ ...plainCard(`${EMOJI.DENY}  ${t(lang, `mediaonly.notice.${result.reason}`, { user: message.author.id })}`, 0xff6b6b), allowedMentions: { users: [message.author.id], parse: [] } }).catch(() => null);
    if (sent) setTimeout(() => sent.delete().catch(() => {}), NOTICE_SECONDS * 1000);
  },
};

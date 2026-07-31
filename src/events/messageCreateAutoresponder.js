const { Events, EmbedBuilder } = require('discord.js');
const arDb = require('../db/autoResponders');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('../utils/embedBuilder');
const { resolve } = require('../utils/embedVariables');
const logger = require('../utils/logger');

/** Pulls role/user mentions typed into a resolved reply (e.g. "@staff") so they can be allow-listed. */
function extractMentions(text) {
  if (!text) return { users: [], roles: [] };
  const users = [...new Set([...text.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))];
  const roles = [...new Set([...text.matchAll(/<@&(\d+)>/g)].map((m) => m[1]))];
  return { users, roles };
}

function matches(ar, content) {
  const lower = content.toLowerCase();
  const trigger = ar.trigger.toLowerCase();

  switch (ar.match_mode) {
    case 'startsWith':
      return lower.startsWith(trigger);
    case 'endsWith':
      return lower.endsWith(trigger);
    case 'exact':
      return lower === trigger;
    case 'regex':
      try {
        return new RegExp(ar.trigger, 'i').test(content);
      } catch {
        return false;
      }
    default:
      return lower.includes(trigger);
  }
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.member) return;

    try {
      const list = await arDb.listForGuild(message.guild.id);
      if (!list.length) return;

      const ctx = { member: message.member, guild: message.guild, channel: message.channel, message };

      for (const ar of list) {
        if (ar.channel_ids.length && !ar.channel_ids.includes(message.channel.id)) continue;
        if (ar.role_ids?.length && !ar.role_ids.some((roleId) => message.member.roles.cache.has(roleId))) continue;
        if (!matches(ar, message.content)) continue;

        let payload;
        if (ar.embed_template) {
          const doc = await getTemplate(message.guild.id, ar.embed_template);
          if (doc) {
            payload = await build(doc.data, ctx);
          } else {
            logger.warn(`Autoresponder ${ar.ar_id}: embed template "${ar.embed_template}" not found, falling back to plain text.`);
            payload = { content: await resolve(ar.reply, ctx) };
          }
        } else if (ar.reply_type === 'embed') {
          const text = await resolve(ar.reply, ctx);
          const embed = new EmbedBuilder().setColor(ar.embed_color ?? 0x8399ff).setDescription(text);
          if (ar.embed_title) embed.setTitle(await resolve(ar.embed_title, ctx));
          if (ar.embed_footer) embed.setFooter({ text: await resolve(ar.embed_footer, ctx) });
          payload = { embeds: [embed] };
        } else {
          payload = { content: await resolve(ar.reply, ctx) };
        }

        // A ping only actually notifies if the mention text is present AND allowedMentions opts
        // it back in — the bot's global default (allowedMentions.parse=[]) suppresses everything,
        // including any @role/@user typed straight into the reply text (e.g. "@staff").
        // Note: mentions inside an embed's description/title/footer never ping on Discord's side
        // regardless of allowedMentions — this only rescues plain-text content.
        if (ar.ping_user) payload.content = `${message.author} ${payload.content ?? ''}`.trim();
        const { users, roles } = extractMentions(payload.content);
        const allowedMentions = { repliedUser: false, users, roles };

        if (ar.reply_to_trigger && !ar.delete_trigger) {
          await message.reply({ ...payload, allowedMentions }).catch((err) => logger.warn(`Autoresponder ${ar.ar_id} send failed:`, err.message));
        } else {
          await message.channel.send({ ...payload, allowedMentions }).catch((err) => logger.warn(`Autoresponder ${ar.ar_id} send failed:`, err.message));
        }
        if (ar.delete_trigger) await message.delete().catch(() => {});
      }
    } catch (err) {
      logger.error(`Autoresponder handling failed for message ${message.id}:`, err);
    }
  },
};

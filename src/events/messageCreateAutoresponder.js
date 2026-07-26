const { Events, EmbedBuilder } = require('discord.js');
const arDb = require('../db/autoResponders');
const { resolve } = require('../utils/embedVariables');
const logger = require('../utils/logger');

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
        if (!matches(ar, message.content)) continue;

        const text = await resolve(ar.reply, ctx);
        let payload;
        if (ar.reply_type === 'embed') {
          const embed = new EmbedBuilder().setColor(ar.embed_color ?? 0x8399ff).setDescription(text);
          if (ar.embed_title) embed.setTitle(await resolve(ar.embed_title, ctx));
          if (ar.embed_footer) embed.setFooter({ text: await resolve(ar.embed_footer, ctx) });
          payload = { embeds: [embed] };
        } else {
          payload = { content: text };
        }

        await message.channel.send(payload).catch((err) => logger.warn(`Autoresponder ${ar.ar_id} send failed:`, err.message));
        if (ar.delete_trigger) await message.delete().catch(() => {});
      }
    } catch (err) {
      logger.error(`Autoresponder handling failed for message ${message.id}:`, err);
    }
  },
};

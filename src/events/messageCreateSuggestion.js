// A server can turn its suggestions channel into a place where every message is a suggestion: the message is posted again as a
// suggestion (with the votes) and the original is deleted. Commands are left alone.
const { Events, PermissionFlagsBits } = require('discord.js');
const guildPrefixes = require('../utils/guildPrefixes');
const db = require('../db/suggestions');
const { submit } = require('../utils/suggestions');
const { ensureGuild } = require('../db/guilds');
const logger = require('../utils/logger');

const TTL_MS = 30_000;
const cache = new Map(); // guildId -> { config, prefix, until }

async function settings(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.until > Date.now()) return hit;
  const config = await db.getConfig(guildId);
  // The prefix is only needed when this server listens to the channel, so the common case is one read.
  const prefixes = config.enabled && config.listen_channel ? guildPrefixes.prefixesOf(await ensureGuild(guildId).catch(() => null)) : ['!'];
  const entry = { config, prefixes, until: Date.now() + TTL_MS };
  cache.set(guildId, entry);
  return entry;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot || message.webhookId || message.system) return;
    try {
      const { config, prefixes } = await settings(message.guild.id);
      if (!config.enabled || !config.listen_channel || message.channelId !== config.channel_id) return;
      const content = message.content ?? '';
      // A message that starts with a symbol prefix of the server is a command, not a suggestion; one that starts with a word prefix
      // (`petto help`) only when it really is a command, so a sentence that starts with that word can still be a suggestion.
      const ways = guildPrefixes.candidatesFor(content, prefixes.map((prefix, index) => ({ prefix, source: 'server', main: index === 0 })));
      if (ways.some((way) => !way.word)) return;
      if (ways.length && await require('./messageCreateCommands').isCommandMessage(message)) return;
      if (!content.trim() && !message.attachments.size) return;
      const result = await submit({ guild: message.guild, user: message.author, text: content, attachments: [...message.attachments.values()] });
      if (result.error) {
        const notice = await message.reply({ content: result.error, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => null);
        if (notice) setTimeout(() => { notice.delete().catch(() => {}); message.delete().catch(() => {}); }, 8000).unref?.();
        return;
      }
      if (message.channel.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) await message.delete().catch(() => {});
    } catch (err) {
      logger.warn(`A message in the suggestions channel failed in ${message.guild.id}: ${err.message}`);
    }
  },
  /** Called when the settings change in the same process (the command): the next message reads them again. */
  forget: (guildId) => cache.delete(guildId),
};

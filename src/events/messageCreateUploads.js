// Counts uploads: a message with files in one of the upload channels counts for its author. The first one gives the uploader
// role and sends the welcome.
const { Events } = require('discord.js');
const uploadsDb = require('../db/uploads');
const { textOf, DEFAULT_WELCOME } = require('../utils/uploadMessages');
const { templatePayload } = require('../utils/templatedMessage');
const { resolve } = require('../utils/embedVariables');
const { applyReactReplies } = require('../utils/messageFlags');
const logger = require('../utils/logger');

async function welcome(message, config) {
  const ctx = { guild: message.guild, member: message.member, user: message.author, channel: message.channel, message };
  const saved = config.welcome ?? {};
  const payload = saved.template ? await templatePayload(message.guild.id, saved.template, ctx) : null;
  const content = payload ? null : (await resolve(textOf(config.welcome, DEFAULT_WELCOME), ctx)).slice(0, 2000) || DEFAULT_WELCOME;
  const sent = await message.channel.send({ ...(payload ?? { content }), allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (sent && payload?.reactions?.length) await applyReactReplies(sent, payload.reactions);
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.attachments?.size) return;

    try {
      const config = await uploadsDb.getConfigCached(message.guild.id);
      if (!config?.enabled || !config.channel_ids.includes(message.channel.id)) return;

      const first = !(await uploadsDb.hasUploaded(message.guild.id, message.author.id));
      const row = await uploadsDb.addLog({ guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id, messageId: message.id, files: message.attachments.size });
      if (!row || !first) return;

      if (config.uploader_role_id && message.member && !message.member.roles.cache.has(config.uploader_role_id)) {
        const role = message.guild.roles.cache.get(config.uploader_role_id);
        if (role && !role.managed && role.position < (message.guild.members.me?.roles.highest.position ?? 0)) await message.member.roles.add(role, 'First upload').catch(() => null);
      }
      await welcome(message, config);
    } catch (error) {
      logger.error(`Upload check failed in guild ${message.guild.id}:`, error);
    }
  },
};

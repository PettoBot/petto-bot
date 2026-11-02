// Counts uploads: a message with files in one of the upload channels counts for its author. The first one gives the uploader
// role and sends the welcome.
const { Events } = require('discord.js');
const uploadsDb = require('../db/uploads');
const { textOf, defaultWelcome } = require('../utils/uploadMessages');
const { templatePayload } = require('../utils/templatedMessage');
const { resolve } = require('../utils/embedVariables');
const { awardMilestones } = require('../utils/milestones');
const { applyReactReplies } = require('../utils/messageFlags');
const logger = require('../utils/logger');
const { t, peekGuildLanguage } = require('../i18n');

async function welcome(message, config, lang) {
  const ctx = { guild: message.guild, member: message.member, user: message.author, channel: message.channel, message };
  const saved = config.welcome ?? {};
  const payload = saved.template ? await templatePayload(message.guild.id, saved.template, ctx) : null;
  const fallback = defaultWelcome(lang);
  const content = payload ? null : (await resolve(textOf(config.welcome, fallback), ctx)).slice(0, 2000) || fallback;
  const sent = await message.channel.send({ ...(payload ?? { content }), allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (sent && payload?.reactions?.length) await applyReactReplies(sent, payload.reactions);
}

// One member's uploads are handled one at a time: two files posted at the same moment cannot both be "the first".
const queues = new Map();
function serial(key, work) {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, run);
  const clear = () => { if (queues.get(key) === run) queues.delete(key); };
  run.then(clear, clear);
  return run;
}

/** Whether the channel (or the forum or channel a thread belongs to) is one of the upload channels. */
const isUploadChannel = (config, channel) => config.channel_ids.includes(channel.id) || (channel.parentId != null && config.channel_ids.includes(channel.parentId));

module.exports = {
  name: Events.MessageCreate,
  isUploadChannel,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.attachments?.size) return;

    try {
      const config = await uploadsDb.getConfigCached(message.guild.id);
      if (!config?.enabled || !isUploadChannel(config, message.channel)) return;
      await serial(`${message.guild.id}:${message.author.id}`, () => count(message, config));
    } catch (error) {
      logger.error(`Upload check failed in guild ${message.guild.id}:`, error);
    }
  },
};

async function count(message, config) {
  try {
    const first = !(await uploadsDb.hasUploaded(message.guild.id, message.author.id));
    const row = await uploadsDb.addLog({ guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id, messageId: message.id, files: message.attachments.size });
    if (!row) return;
    // The milestones run after the count and never get in its way.
    try {
      const total = await uploadsDb.countFor(message.guild.id, message.author.id);
      await awardMilestones({ guild: message.guild, member: message.member ?? null, user: message.author, kind: 'upload', total, channel: message.channel, ctx: { message }, lang: (message.pettoLang ?? peekGuildLanguage(message.guild.id)) });
    } catch (error) {
      logger.warn(`Upload milestones failed in guild ${message.guild.id}: ${error.message}`);
    }
    if (!first) return;

    const lang = (message.pettoLang ?? peekGuildLanguage(message.guild.id));
    if (config.uploader_role_id && message.member && !message.member.roles.cache.has(config.uploader_role_id)) {
      const role = message.guild.roles.cache.get(config.uploader_role_id);
      if (role && !role.managed && role.position < (message.guild.members.me?.roles.highest.position ?? 0)) await message.member.roles.add(role, t(lang, 'uploads.auditReason')).catch(() => null);
    }
    await welcome(message, config, lang);
  } catch (error) {
    logger.error(`Upload check failed in guild ${message.guild.id}:`, error);
  }
}

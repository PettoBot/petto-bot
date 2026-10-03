// Counts partnerships: when a Partner Manager posts the invite of another server in a partner channel, the invite is
// checked against the requirements of the server and, if it passes, it is counted and answered.
const { Events, PermissionFlagsBits } = require('discord.js');
const partnersDb = require('../db/partners');
const { extractInviteCodes, snowflakeDate, judge, counts } = require('../utils/partnerEngine');
const { partnerContext, responsePayload } = require('../utils/partnerMessages');
const logger = require('../utils/logger');

async function reply(message, config, key, info) {
  const ctx = { guild: message.guild, member: message.member, user: message.author, channel: message.channel, message, partner: partnerContext({ ...info, config, managerId: message.author.id, managerName: message.author.username }) };
  const payload = await responsePayload(message.guild.id, config, key, ctx);
  await message.reply({ ...payload, failIfNotExists: false }).catch(() => null);
}

async function handleInvite(message, config, code) {
  const invite = await message.client.fetchInvite(code).catch(() => null);
  if (!invite?.guild) {
    await reply(message, config, 'invalid_invite', { invite: `https://discord.gg/${code}` });
    return { blocked: true };
  }
  const found = {
    guildId: invite.guild.id,
    name: invite.guild.name,
    members: invite.memberCount ?? null,
    createdAt: snowflakeDate(invite.guild.id),
  };
  const [blacklisted, last] = await Promise.all([partnersDb.isBlacklisted(message.guild.id, found.guildId), partnersDb.lastWith(message.guild.id, found.guildId)]);
  const reason = judge({ invite: found, ownGuildId: message.guild.id, config, blacklisted, last });
  const base = { name: found.name, id: found.guildId, members: found.members, invite: `https://discord.gg/${invite.code}`, cooldownEndsUnix: last && config.cooldown_days ? Math.floor(new Date(last.created_at).getTime() / 1000) + config.cooldown_days * 86400 : null };
  if (reason) {
    await reply(message, config, reason, base);
    return { blocked: true };
  }

  const history = await partnersDb.listLog(message.guild.id, { managerId: message.author.id });
  const row = await partnersDb.addLog({ guildId: message.guild.id, managerId: message.author.id, partnerGuildId: found.guildId, partnerName: found.name, members: found.members, inviteCode: invite.code, channelId: message.channel.id, messageId: message.id });
  const total = counts([{ created_at: row.created_at }, ...history]);
  await reply(message, config, 'completed', { ...base, counts: total });
  if (config.react_emoji) await message.react(config.react_emoji).catch(() => null);
  return { blocked: false };
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.content) return;

    try {
      const config = await partnersDb.getConfigCached(message.guild.id);
      if (!config?.enabled || !config.channel_ids.includes(message.channel.id)) return;
      if (config.manager_role_id && !message.member?.roles.cache.has(config.manager_role_id)) return;

      const codes = extractInviteCodes(message.content);
      if (!codes.length) return;

      let blockedAny = false;
      for (const code of codes) {
        const result = await handleInvite(message, config, code);
        if (result.blocked) blockedAny = true;
      }
      if (blockedAny && !config.keep_original && message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) await message.delete().catch(() => null);
    } catch (error) {
      logger.error(`Partner check failed in guild ${message.guild.id}:`, error);
    }
  },
};

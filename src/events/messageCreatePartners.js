// Counts partnerships: when a Partner Manager posts the invite of another server in a partner channel, the invite is
// checked against the requirements of the server and, if it passes, it is counted and answered.
const { Events, PermissionFlagsBits } = require('discord.js');
const partnersDb = require('../db/partners');
const { extractInviteCodes, snowflakeDate, judge, counts, standings, cooldownMinutes } = require('../utils/partnerEngine');
const { partnerContext, responsePayload } = require('../utils/partnerMessages');
const { applyReactReplies } = require('../utils/messageFlags');
const logger = require('../utils/logger');

async function reply(message, config, key, info) {
  const ctx = { guild: message.guild, member: message.member, user: message.author, channel: message.channel, message, partner: partnerContext({ ...info, config, managerId: message.author.id, managerName: message.author.username }) };
  const payload = await responsePayload(message.guild.id, config, key, ctx);
  const sent = await message.reply({ ...payload, failIfNotExists: false }).catch(() => null);
  if (sent && payload.reactions?.length) await applyReactReplies(sent, payload.reactions);
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
    // Discord marks servers as explicit (1) or age restricted (3).
    nsfw: [1, 3].includes(invite.guild.nsfwLevel),
    text: `${invite.guild.name ?? ''} ${invite.guild.description ?? ''}`,
  };
  const [blacklisted, last] = await Promise.all([partnersDb.isBlacklisted(message.guild.id, found.guildId), partnersDb.lastWith(message.guild.id, found.guildId)]);
  const reason = judge({ invite: found, ownGuildId: message.guild.id, config, blacklisted, last });
  const base = { name: found.name, id: found.guildId, members: found.members, invite: `https://discord.gg/${invite.code}`, cooldownEndsUnix: last && cooldownMinutes(config) ? Math.floor(new Date(last.created_at).getTime() / 1000) + cooldownMinutes(config) * 60 : null };
  if (reason) {
    await reply(message, config, reason, base);
    return { blocked: true };
  }

  const row = await partnersDb.addLog({ guildId: message.guild.id, managerId: message.author.id, partnerGuildId: found.guildId, partnerName: found.name, members: found.members, inviteCode: invite.code, channelId: message.channel.id, messageId: message.id });
  const all = await partnersDb.listLog(message.guild.id);
  const rows = all.some((item) => item.id === row.id) ? all : [row, ...all];
  await reply(message, config, 'completed', { ...base, counts: counts(rows.filter((item) => item.manager_id === message.author.id)), standings: standings(rows, message.author.id) });
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

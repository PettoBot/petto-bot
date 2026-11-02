// Counts partnerships: when a Partner Manager posts the invite of another server in a partner channel, the invite is
// checked against the requirements of the server and, if it passes, it is counted and answered.
const { Events, PermissionFlagsBits } = require('discord.js');
const partnersDb = require('../db/partners');
const { extractInviteCodes, snowflakeDate, judge, counts, standings, cooldownMinutes } = require('../utils/partnerEngine');
const { partnerContext, responsePayload } = require('../utils/partnerMessages');
const { awardMilestones } = require('../utils/milestones');
const { applyNickname } = require('../utils/partnerNickname');
const { applyReactReplies } = require('../utils/messageFlags');
const logger = require('../utils/logger');
const { t, peekGuildLanguage } = require('../i18n');

async function reply(message, config, key, info, lang) {
  const ctx = { guild: message.guild, member: message.member, user: message.author, channel: message.channel, message, partner: partnerContext({ ...info, config, managerId: message.author.id, managerName: message.author.username }, lang) };
  const payload = await responsePayload(message.guild.id, config, key, ctx, lang);
  const sent = await message.reply({ ...payload, failIfNotExists: false }).catch(() => null);
  if (sent && payload.reactions?.length) await applyReactReplies(sent, payload.reactions);
  return sent;
}

// The notice about an ad that was taken down is only for the poster: it goes away by itself.
const NOTICE_SECONDS = 15;
const canDelete = (message) => Boolean(message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UNKNOWN_INVITE = 10006;

/**
 * The invite, or `{ invite: null, unreachable }`: an invite Discord says does not exist is invalid, but a failure of the connection or a
 * rate limit is not the invite's fault, so it is tried again and, if it keeps failing, nobody's message is thrown away.
 */
async function lookUpInvite(client, code) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return { invite: await client.fetchInvite(code), unreachable: false };
    } catch (error) {
      last = error;
      if (error?.code === UNKNOWN_INVITE || error?.status === 404) return { invite: null, unreachable: false };
      await sleep(400 * (attempt + 1) + Math.floor(Math.random() * 200));
    }
  }
  logger.warn(`Could not look up the invite ${code}: ${last?.message ?? last}`);
  return { invite: null, unreachable: true };
}

async function handleInvite(message, config, code, lang, seen = new Set(), looked = null) {
  const { invite, unreachable } = looked ?? await lookUpInvite(message.client, code);
  if (unreachable) {
    await message.reply({ content: t(lang, 'partners.inviteUnreachable'), failIfNotExists: false, allowedMentions: { repliedUser: false } }).catch(() => null);
    return { blocked: false };
  }
  if (!invite?.guild) {
    await reply(message, config, 'invalid_invite', { invite: `https://discord.gg/${code}` }, lang);
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
  // Two invites of the same server in one message are one partnership.
  if (seen.has(String(found.guildId))) return { blocked: false, duplicate: true };
  seen.add(String(found.guildId));
  const [blacklisted, last] = await Promise.all([partnersDb.isBlacklisted(message.guild.id, found.guildId), partnersDb.lastWith(message.guild.id, found.guildId)]);
  const reason = judge({ invite: found, ownGuildId: message.guild.id, config, blacklisted, last });
  const base = { name: found.name, id: found.guildId, members: found.members, invite: `https://discord.gg/${invite.code}`, cooldownEndsUnix: last && cooldownMinutes(config) ? Math.floor(new Date(last.created_at).getTime() / 1000) + cooldownMinutes(config) * 60 : null };
  if (reason === 'blacklisted' && canDelete(message)) {
    // The ad of a blacklisted server is taken down; the poster is told in a short message that disappears. Without Manage Messages it is only answered.
    const gone = await message.delete().then(() => true, () => false);
    const sent = await reply(message, config, reason, base, lang);
    if (gone && sent?.delete) setTimeout(() => { sent.delete().catch(() => null); }, NOTICE_SECONDS * 1000).unref?.();
    logger.info(`Partner ad with a blacklisted server (${found.guildId}) from ${message.author.id} in guild ${message.guild.id}${gone ? ' deleted' : ' not deleted'}.`);
    return { blocked: true, deleted: gone };
  }
  if (reason) {
    await reply(message, config, reason, base, lang);
    return { blocked: true };
  }

  const row = await partnersDb.addLog({ guildId: message.guild.id, managerId: message.author.id, partnerGuildId: found.guildId, partnerName: found.name, members: found.members, inviteCode: invite.code, channelId: message.channel.id, messageId: message.id });
  const all = await partnersDb.listLog(message.guild.id);
  const rows = all.some((item) => item.id === row.id) ? all : [row, ...all];
  await reply(message, config, 'completed', { ...base, counts: counts(rows.filter((item) => item.manager_id === message.author.id)), standings: standings(rows, message.author.id) }, lang);
  if (config.react_emoji) await message.react(config.react_emoji).catch(() => null);
  const mine = rows.filter((item) => item.manager_id === message.author.id);
  // The nickname and the milestones come after the answer and never stop the count.
  const member = message.member ?? null;
  await applyNickname({ guild: message.guild, member, user: message.author, config, total: mine.length, lang });
  await awardMilestones({ guild: message.guild, member, user: message.author, kind: 'partner', total: mine.length, channel: message.channel, ctx: { message, partner: partnerContext({ ...base, config, managerId: message.author.id, managerName: message.author.username, counts: counts(mine), standings: standings(rows, message.author.id) }, lang) }, lang });
  return { blocked: false };
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.content) return;

    try {
      const config = await partnersDb.getConfigCached(message.guild.id);
      if (!config?.enabled || !config.channel_ids.includes(message.channel.id)) return;
      // The member can be missing from memory (a message from someone Petto has not seen lately): it is fetched, not taken as "not a manager".
      if (config.manager_role_id) {
        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member?.roles.cache.has(config.manager_role_id)) return;
      }

      const codes = extractInviteCodes(message.content);
      if (!codes.length) return;

      const lang = (message.pettoLang ?? peekGuildLanguage(message.guild.id));
      let blockedAny = false;
      let deleted = false;
      const seen = new Set();
      // With Manage Messages, an ad that has the invite of a blacklisted server is taken down before anything else in it is counted.
      const lookups = new Map();
      let order = codes;
      if (canDelete(message)) {
        const bad = [];
        for (const code of codes) {
          const looked = await lookUpInvite(message.client, code);
          lookups.set(code, looked);
          const guildId = looked.invite?.guild?.id;
          if (guildId && String(guildId) !== String(message.guild.id) && await partnersDb.isBlacklisted(message.guild.id, guildId).catch(() => false)) bad.push(code);
        }
        order = [...bad, ...codes.filter((code) => !bad.includes(code))];
      }
      for (const code of order) {
        const result = await handleInvite(message, config, code, lang, seen, lookups.get(code) ?? null);
        if (result.blocked) blockedAny = true;
        if (result.deleted) { deleted = true; break; }
      }
      if (blockedAny && !deleted && !config.keep_original && canDelete(message)) await message.delete().catch(() => null);
    } catch (error) {
      logger.error(`Partner check failed in guild ${message.guild.id}:`, error);
    }
  },
};

const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { getHoneypot, listHoneypots, setPanelMessage, claimHoneypotUser } = require('../db/honeypot');
const { createCase } = require('../db/modActions');
const { logSanction } = require('./caseLog');
const { sanctionDM } = require('./sanctionTemplates');
const { sendLog } = require('../logging/engine');
const { buildHoneypotPanel, buildHoneypotImageAttachment, punishmentText } = require('./honeypotPanel');
const { templatePayload } = require('./templatedMessage');
const { resolve } = require('./embedVariables');
const { applyReactReplies } = require('./messageFlags');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, currentLanguage, guildLanguage } = require('../i18n');
const { sendDm } = require('./dmOrigin');

const CONFIG_CACHE_MS = 15_000;
const PANEL_UPDATE_DELAY_MS = 750;
const configCache = new Map();
const panelUpdates = new Map();
const activeUsers = new Set();

/** A punishment value (ban, softban, kick) as the log names it; an unknown value as it is. */
function actionWord(value, lang) {
  const key = `security.action.${value}`;
  const text = t(lang, key);
  return text === key ? String(value) : text;
}

function isStaffExempt(message) {
  const member = message.member;
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  return member.permissions?.has(PermissionFlagsBits.Administrator)
    || member.permissions?.has(PermissionFlagsBits.ManageMessages);
}

async function getConfiguredHoneypot(guildId, channelId) {
  const cached = configCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows.find((row) => row.channel_id === channelId) ?? null;
  }

  const rows = await listHoneypots(guildId);
  configCache.set(guildId, { rows, expiresAt: Date.now() + CONFIG_CACHE_MS });
  return rows.find((row) => row.channel_id === channelId) ?? null;
}

function invalidateHoneypotCache(guildId) {
  configCache.delete(guildId);
}

function schedulePanelUpdate(client, row) {
  if (!row?.panel_message_id) return;

  const key = `${row.guild_id}:${row.channel_id}`;
  const current = panelUpdates.get(key) ?? { row, timer: null };
  current.row = row;
  panelUpdates.set(key, current);
  if (current.timer) return;

  current.timer = setTimeout(async () => {
    panelUpdates.delete(key);

    try {
      const guild = client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.channel_id)
        ?? await client.channels.fetch(row.channel_id).catch(() => null);
      if (!channel?.messages?.fetch) return;

      const panel = await channel.messages.fetch(current.row.panel_message_id).catch(() => null);
      if (!panel || panel.author?.id !== client.user?.id) return;

      // A timer is not inside the server's language: the panel is drawn in the language the server chose.
      const payload = await renderPanel(channel, current.row, await guildLanguage(row.guild_id));
      if (payload) await panel.edit(payload);
    } catch (err) {
      logger.warn(`Honeypot panel update failed in ${row.guild_id}/${row.channel_id}:`, err.message);
    }
  }, PANEL_UPDATE_DELAY_MS);

  current.timer.unref?.();
}

/**
 * What is posted in the bait channel: the warning panel Petto makes (`default`), the text and/or saved embed of the server
 * (`custom`, with `{honeypot.*}` variables, and the panel when neither is usable), or nothing at all (`none`, null here).
 */
async function renderPanel(channel, row, lang = currentLanguage()) {
  const mode = row.panel_mode ?? 'default';
  if (mode === 'none') return null;
  if (mode === 'custom') {
    const ctx = {
      guild: channel.guild,
      channel,
      honeypot: { action: punishmentText(row.punishment, lang), count: String(Math.max(0, Number(row.caught_count) || 0)), channel: `<#${channel.id}>` },
    };
    let payload = row.panel_template ? await templatePayload(channel.guild.id, row.panel_template, ctx) : null;
    if (!payload && row.panel_text?.trim()) {
      const content = (await resolve(row.panel_text, ctx)).slice(0, 2000).trim();
      if (content) payload = { content };
    }
    if (payload) return { ...payload, allowedMentions: { parse: [] } };
  }
  return { components: [buildHoneypotPanel({ ...row, lang })], files: [buildHoneypotImageAttachment()], flags: MessageFlags.IsComponentsV2 };
}

async function createOrUpdatePanel(client, channel, row, lang = currentLanguage()) {
  let panel = null;

  if (row.panel_message_id) {
    panel = await channel.messages.fetch(row.panel_message_id).catch(() => null);
    if (panel?.author?.id !== client.user?.id) panel = null;
  }

  const payload = await renderPanel(channel, row, lang);
  if (!payload) {
    // Nothing is posted: the panel that was there goes away.
    if (panel) await panel.delete().catch(() => {});
    const cleared = row.panel_message_id ? await setPanelMessage(row.guild_id, row.channel_id, null) : row;
    invalidateHoneypotCache(row.guild_id);
    return cleared;
  }

  let posted = null;
  if (panel) {
    // A Components V2 message can not become a normal one (or the other way round), so then it is replaced.
    posted = await panel.edit(payload).catch(() => null);
    if (!posted) await panel.delete().catch(() => {});
  }
  if (!posted) {
    posted = await channel.send(payload);
    if (payload.reactions?.length) await applyReactReplies(posted, payload.reactions);
  }

  const updated = await setPanelMessage(row.guild_id, row.channel_id, posted.id);
  invalidateHoneypotCache(row.guild_id);
  return updated;
}

async function deletePanel(client, row) {
  if (!row?.panel_message_id) return;

  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  const panel = channel?.messages?.fetch
    ? await channel.messages.fetch(row.panel_message_id).catch(() => null)
    : null;
  if (panel?.author?.id === client.user?.id) await panel.delete().catch(() => {});
}

// A softban lets the member come back; the re-invite sent with the DM is how they find their way: one use, a week.
const REINVITE_MAX_AGE_S = 7 * 24 * 3600;
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/**
 * The channel the re-invite opens on: the rules or system channel, otherwise the first text channel everyone can see. Never a bait
 * channel (a member who comes back must not land in the trap), and only where Petto can make invites. Null when there is none.
 */
async function reinviteChannel(guild, baitIds = new Set()) {
  const me = guild.members?.me;
  if (!me) return null;
  const everyone = guild.roles?.everyone ?? null;
  const usable = (channel) => channel && TEXT_TYPES.has(channel.type) && !baitIds.has(channel.id)
    && channel.permissionsFor?.(me)?.has(PermissionFlagsBits.CreateInstantInvite);
  const visible = (channel) => !everyone || channel.permissionsFor?.(everyone)?.has(PermissionFlagsBits.ViewChannel);
  const ordered = [guild.rulesChannel, guild.systemChannel, ...[...(guild.channels?.cache?.values?.() ?? [])].sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))];
  return ordered.find((channel) => usable(channel) && visible(channel)) ?? null;
}

/** A single-use invite that lasts a week, or null (with the reason) when Petto can not make one. */
async function createReinvite(guild, reason) {
  const baitIds = new Set((await listHoneypots(guild.id).catch(() => [])).map((row) => row.channel_id));
  const channel = await reinviteChannel(guild, baitIds);
  if (!channel) return { invite: null, problem: 'noPermission' };
  try {
    const invite = await channel.createInvite({ maxAge: REINVITE_MAX_AGE_S, maxUses: 1, unique: true, reason });
    return { invite, problem: null };
  } catch (err) {
    logger.warn(`Honeypot: could not create a re-invite in ${guild.id}/${channel.id}:`, err.message);
    return { invite: null, problem: 'failed' };
  }
}

/**
 * Writes to the member the honeypot caught (when the honeypot is set to): the sanction DM of the server and, for a softban with the
 * re-invite on, a single-use link back. Answers what happened, for the log: `off`, `sent`, `sentInvite`, `noInvite` (sent, but no
 * invite could be made), or `closed` (their DMs are closed; the invite made for it is deleted again).
 */
async function messageCaughtMember({ guild, client, author, member, config, punishment, reason, lang }) {
  if (config.dm_member === false) return 'off';
  let payload;
  try {
    payload = await sanctionDM({ type: punishment, guild, client, reason, user: author, member, source: 'honeypot' });
  } catch (err) {
    logger.warn(`Honeypot: the DM of ${author.id} in ${guild.id} could not be drawn:`, err.message);
    return 'closed';
  }
  const wantsInvite = punishment === 'softban' && config.reinvite !== false;
  const { invite, problem } = wantsInvite ? await createReinvite(guild, t(lang, 'security.honeypot.reinvite.audit')) : { invite: null, problem: null };
  if (problem === 'noPermission') logger.info(`Honeypot: no channel where I can create invites in ${guild.id}; the softbanned member gets no re-invite.`);
  try {
    await sendDm(author, payload, { guild, kind: 'security' });
  } catch (err) {
    logger.info(`Honeypot: could not DM ${author.id} in ${guild.id} (${err.message}).`);
    if (invite) await invite.delete().catch(() => {});
    return 'closed';
  }
  if (!wantsInvite) return 'sent';
  if (!invite) return 'noInvite';
  const dmLang = await guildLanguage(guild.id).catch(() => lang);
  try {
    await sendDm(author, { content: t(dmLang, 'security.honeypot.reinvite.dm', { server: guild.name, url: invite.url ?? `https://discord.gg/${invite.code}` }), allowedMentions: { parse: [] } }, { guild, kind: 'security' });
    return 'sentInvite';
  } catch (err) {
    logger.info(`Honeypot: the re-invite could not be sent to ${author.id} in ${guild.id} (${err.message}).`);
    await invite.delete().catch(() => {});
    return 'noInvite';
  }
}

async function applyHoneypotAction(message, config) {
  const { guild, author } = message;
  const client = message.client;
  const punishment = config.punishment;
  const lang = currentLanguage();
  const reason = t(lang, 'security.honeypot.reason');
  const fullReason = t(lang, 'security.automod.reason', { reason });

  await message.delete().catch((err) => logger.warn(`Honeypot: failed to delete message ${message.id}:`, err.message));

  let claimed;
  try {
    claimed = await claimHoneypotUser(guild.id, message.channel.id, author.id, message.id, punishment);
  } catch (err) {
    // Do not apply a punishment when the durable claim cannot be recorded: a
    // retrying message could otherwise create duplicate cases after a DB hiccup.
    logger.error(`Honeypot claim failed in ${guild.id}/${message.channel.id} for ${author.id}:`, err.message);
    return false;
  }

  if (!claimed) return false;

  const updated = await getHoneypot(guild.id, message.channel.id).catch((err) => {
    logger.warn(`Honeypot count reload failed in ${guild.id}/${message.channel.id}:`, err.message);
    return null;
  });
  schedulePanelUpdate(client, updated ?? {
    ...config,
    caught_count: (config.caught_count ?? 0) + 1,
  });

  // The member is written to before the punishment: once they are out of the server Discord no longer lets Petto reach them.
  const dm = await messageCaughtMember({ guild, client, author, member: message.member, config, punishment, reason: fullReason, lang });

  await sendLog(client, guild.id, 'automod', {
    author: { name: author.username, icon_url: author.displayAvatarURL?.() ?? undefined },
    description: t(lang, 'security.honeypot.log', { emoji: EMOJI.ALERT, channel: `<#${message.channel.id}>`, user: `<@${author.id}>`, action: actionWord(punishment, lang), reason }) + `\n${t(lang, `security.honeypot.logDm.${dm}`)}`,
    color: 0xfe6465,
    footer: { text: t(lang, 'security.log.userId', { id: author.id }) },
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error('Honeypot: failed to send automod log:', err));

  try {
    await ensureGuild(guild.id);

    if (punishment === 'ban') {
      await guild.members.ban(author.id, { reason: fullReason, deleteMessageSeconds: 86400 });
    } else if (punishment === 'softban') {
      await guild.members.ban(author.id, { reason: fullReason, deleteMessageSeconds: 86400 });
      await guild.members.unban(author.id, t(lang, 'security.honeypot.audit.softban'));
    } else {
      const member = message.member ?? await guild.members.fetch(author.id).catch(() => null);
      if (!member) throw new Error('The triggering user is no longer a guild member, so the kick could not be applied.'); // i18n-ignore: only logged
      await member.kick(fullReason);
    }

    const modCase = await createCase({
      guildId: guild.id,
      userId: author.id,
      moderatorId: client.user.id,
      type: punishment,
      reason: fullReason,
      source: 'honeypot',
    });
    await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason });
  } catch (err) {
    logger.warn(`Honeypot: failed to apply ${punishment} to ${author.id} in ${guild.id}:`, err.message);
  }

  return true;
}

async function handleHoneypotMessage(message) {
  if (!message.guild || message.author.id === message.client.user?.id) return false;

  const config = await getConfiguredHoneypot(message.guild.id, message.channel.id);
  if (!config) return false;
  if (isStaffExempt(message)) return true;

  const userKey = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
  if (activeUsers.has(userKey)) {
    await message.delete().catch((err) => logger.warn(`Honeypot: failed to delete duplicate message ${message.id}:`, err.message));
    return true;
  }

  activeUsers.add(userKey);
  try {
    await applyHoneypotAction(message, config);
  } finally {
    activeUsers.delete(userKey);
  }
  return true;
}

module.exports = {
  isStaffExempt,
  getConfiguredHoneypot,
  invalidateHoneypotCache,
  schedulePanelUpdate,
  renderPanel,
  createOrUpdatePanel,
  deletePanel,
  applyHoneypotAction,
  messageCaughtMember,
  reinviteChannel,
  handleHoneypotMessage,
};

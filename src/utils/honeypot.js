const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { getHoneypot, listHoneypots, setPanelMessage, incrementTrigger } = require('../db/honeypot');
const { createCase } = require('../db/modActions');
const { logSanction } = require('./caseLog');
const { buildSanctionDM } = require('./sanctionMessage');
const { sendLog } = require('../logging/engine');
const { buildHoneypotPanel } = require('./honeypotPanel');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const CONFIG_CACHE_MS = 15_000;
const PANEL_UPDATE_DELAY_MS = 750;
const configCache = new Map();
const panelUpdates = new Map();

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

      await panel.edit({
        components: [buildHoneypotPanel(current.row)],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      logger.warn(`Honeypot panel update failed in ${row.guild_id}/${row.channel_id}:`, err.message);
    }
  }, PANEL_UPDATE_DELAY_MS);

  current.timer.unref?.();
}

async function createOrUpdatePanel(client, channel, row) {
  let panel = null;

  if (row.panel_message_id) {
    panel = await channel.messages.fetch(row.panel_message_id).catch(() => null);
    if (panel?.author?.id !== client.user?.id) panel = null;
  }

  const payload = {
    components: [buildHoneypotPanel(row)],
    flags: MessageFlags.IsComponentsV2,
  };

  if (panel) await panel.edit(payload);
  else panel = await channel.send(payload);

  const updated = await setPanelMessage(row.guild_id, row.channel_id, panel.id);
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

async function applyHoneypotAction(message, config) {
  const { guild, author } = message;
  const client = message.client;
  const punishment = config.punishment;
  const reason = 'Honeypot: sent a message in the honeypot channel.';
  const fullReason = `Automod: ${reason}`;

  await message.delete().catch((err) => logger.warn(`Honeypot: failed to delete message ${message.id}:`, err.message));

  const updated = await incrementTrigger(guild.id, message.channel.id).catch((err) => {
    logger.error(`Honeypot counter update failed in ${guild.id}/${message.channel.id}:`, err.message);
    return { ...config, trigger_count: (config.trigger_count ?? 0) + 1 };
  });
  schedulePanelUpdate(client, updated ?? { ...config, trigger_count: (config.trigger_count ?? 0) + 1 });

  await sendLog(client, guild.id, 'automod', {
    author: { name: author.username, icon_url: author.displayAvatarURL?.() ?? undefined },
    description: `${EMOJI.ALERT} **Honeypot triggered** in <#${message.channel.id}>\n**User:** <@${author.id}>\n**Action:** ${punishment}\n**Reason:** ${reason}`,
    color: 0xfe6465,
    footer: { text: `User ID: ${author.id}` },
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error('Honeypot: failed to send automod log:', err));

  try {
    await ensureGuild(guild.id);
    await author.send(buildSanctionDM({ type: punishment, guild, client, reason: fullReason })).catch(() => {});

    if (punishment === 'ban') {
      await guild.members.ban(author.id, { reason: fullReason, deleteMessageSeconds: 604800 });
    } else if (punishment === 'softban') {
      await guild.members.ban(author.id, { reason: fullReason, deleteMessageSeconds: 604800 });
      await guild.members.unban(author.id, 'Honeypot softban completed.');
    } else {
      const member = message.member ?? await guild.members.fetch(author.id).catch(() => null);
      if (!member) throw new Error('The triggering user is no longer a guild member, so the kick could not be applied.');
      await member.kick(fullReason);
    }

    const modCase = await createCase({
      guildId: guild.id,
      userId: author.id,
      moderatorId: client.user.id,
      type: punishment,
      reason: fullReason,
    });
    await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason });
  } catch (err) {
    logger.warn(`Honeypot: failed to apply ${punishment} to ${author.id} in ${guild.id}:`, err.message);
  }
}

async function handleHoneypotMessage(message) {
  if (!message.guild || message.author.id === message.client.user?.id) return false;

  const config = await getConfiguredHoneypot(message.guild.id, message.channel.id);
  if (!config) return false;
  if (isStaffExempt(message)) return true;

  await applyHoneypotAction(message, config);
  return true;
}

module.exports = {
  isStaffExempt,
  getConfiguredHoneypot,
  invalidateHoneypotCache,
  schedulePanelUpdate,
  createOrUpdatePanel,
  deletePanel,
  applyHoneypotAction,
  handleHoneypotMessage,
};

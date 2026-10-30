// The verification panel of a channel: the message with the buttons to verify. Posted by the command and by the job that follows the dashboard.
const { PermissionFlagsBits } = require('discord.js');
const { getConfig, upsertConfig } = require('../db/verificationConfig');
const { ensureUnverifiedRole } = require('./verifyRole');
const { methodOf } = require('./verifyMethod');
const { buildPanel, isPanelMessage } = require('../interactions/verifyLetters');
const { t, guildLanguage } = require('../i18n');

const NEEDS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageRoles];

// One post at a time in each server: the dashboard's setup, its panel button, the panel job and the command could post at the same
// moment, and each one used to send its own message (two identical panels in the channel).
const posting = new Map(); // guildId -> promise

/**
 * Puts the panel in `channel` and remembers where it is. Throws with a readable reason, in the language of the server. The panel that
 * stands in that channel is edited instead of sent again (one in another channel is taken away), and another copy of the panel found
 * in the channel is deleted.
 */
async function postPanel(guild, settings, channel) {
  const before = posting.get(guild.id) ?? Promise.resolve();
  const run = before.catch(() => {}).then(() => postPanelNow(guild, settings, channel));
  posting.set(guild.id, run);
  try {
    return await run;
  } finally {
    if (posting.get(guild.id) === run) posting.delete(guild.id);
  }
}

/** Whether the gate role already reads (and only reads) this channel: then the overwrite is not sent again. */
function openedToGate(channel, roleId) {
  const overwrite = channel.permissionOverwrites?.cache?.get(roleId);
  if (!overwrite) return false;
  const allowed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory].every((flag) => overwrite.allow?.has?.(flag));
  const denied = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads].every((flag) => overwrite.deny?.has?.(flag));
  return allowed && denied;
}

async function postPanelNow(guild, given, channel) {
  const lang = await guildLanguage(guild.id);
  if (!channel?.isTextBased?.() || !channel.permissionsFor(guild.members.me)?.has(NEEDS)) {
    throw new Error(t(lang, 'verify.panel.cannotPost'));
  }
  // What is saved now: a post that ended a moment ago may have saved its message.
  const settings = { ...given, ...((await getConfig(guild.id).catch(() => null)) ?? {}) };
  // The role of the members who have not verified cannot see any channel, so this one is opened to it (to read, not to write).
  const role = await ensureUnverifiedRole(guild, settings);
  if (!openedToGate(channel, role.id)) {
    await channel.permissionOverwrites.edit(role, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false }, { reason: t(lang, 'verify.reason.panel') });
  }
  const payload = buildPanel({ guild, method: methodOf(settings), lang, imageUrl: settings.panel_image_url });
  let sent = null;
  const where = settings.panel_posted_channel_id ?? settings.panel_channel_id;
  if (settings.panel_message_id && where === channel.id) {
    const standing = await channel.messages.fetch(settings.panel_message_id).catch(() => null);
    if (standing) sent = await standing.edit({ components: payload.components }).catch(() => null);
  }
  if (!sent) {
    await removePanel(guild, settings);
    sent = await channel.send(payload);
  }
  await upsertConfig(guild.id, { panel_channel_id: channel.id, panel_posted_channel_id: channel.id, panel_message_id: sent.id });
  await removeCopies(guild, channel, sent.id);
  return sent;
}

/** Deletes the other verification panels of Petto in the last messages of the channel (one posted twice before this was fixed). */
async function removeCopies(guild, channel, keepId) {
  const meId = guild.members.me?.id ?? guild.client?.user?.id;
  const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recent || !meId) return 0;
  let removed = 0;
  for (const message of recent.values()) {
    if (message.id === keepId || message.author?.id !== meId || !isPanelMessage(message, guild.id)) continue;
    if (await message.delete().then(() => true, () => false)) removed += 1;
  }
  return removed;
}

/** Deletes the panel message that is standing, if any. */
async function removePanel(guild, settings) {
  const where = settings.panel_posted_channel_id ?? settings.panel_channel_id;
  if (!where || !settings.panel_message_id) return;
  const old = await guild.channels.fetch(where).catch(() => null);
  if (old?.isTextBased?.()) await old.messages.delete(settings.panel_message_id).catch(() => {});
}

module.exports = { postPanel, removePanel, removeCopies };

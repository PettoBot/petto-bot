// The verification panel of a channel: the message with the buttons to verify. Posted by the command and by the job that follows the dashboard.
const { PermissionFlagsBits } = require('discord.js');
const { upsertConfig } = require('../db/verificationConfig');
const { ensureUnverifiedRole } = require('./verifyRole');
const { methodOf } = require('./verifyMethod');
const { buildPanel } = require('../interactions/verifyLetters');

const NEEDS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageRoles];

/** Puts the panel in `channel` (taking the old one away) and remembers where it is. Throws with a readable reason. */
async function postPanel(guild, settings, channel) {
  if (!channel?.isTextBased?.() || !channel.permissionsFor(guild.members.me)?.has(NEEDS)) {
    throw new Error('I need to see and write in that channel, and the Manage Roles permission.');
  }
  // The role of the members who have not verified cannot see any channel, so this one is opened to it (to read, not to write).
  const role = await ensureUnverifiedRole(guild, settings);
  await channel.permissionOverwrites.edit(role, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false }, { reason: 'Petto: verification panel' });
  await removePanel(guild, settings);
  const sent = await channel.send(buildPanel({ guild, method: methodOf(settings) }));
  await upsertConfig(guild.id, { panel_channel_id: channel.id, panel_posted_channel_id: channel.id, panel_message_id: sent.id });
  return sent;
}

/** Deletes the panel message that is standing, if any. */
async function removePanel(guild, settings) {
  const where = settings.panel_posted_channel_id ?? settings.panel_channel_id;
  if (!where || !settings.panel_message_id) return;
  const old = await guild.channels.fetch(where).catch(() => null);
  if (old?.isTextBased?.()) await old.messages.delete(settings.panel_message_id).catch(() => {});
}

module.exports = { postPanel, removePanel };

const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const { DANGEROUS_CHANNEL_FLAGS, gainedFlags, overwritesOf } = require('../utils/antiNukeDanger');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// The audit log writes a channel edit as an update, or as an overwrite created, changed or deleted.
const TYPES = [AuditLogEvent.ChannelUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete];

// A channel renamed or its permissions changed. Editing channels in a row is counted; opening a channel to @everyone with a
// dangerous permission answers at once. When the protection answers, the channels go back to how they were.
module.exports = {
  name: Events.ChannelUpdate,
  execute(oldChannel, newChannel) {
    if (!newChannel.guild || newChannel.isThread?.()) return;
    const before = overwritesOf(oldChannel);
    const after = overwritesOf(newChannel);
    const overwritesChanged = JSON.stringify(before) !== JSON.stringify(after);
    const changed = overwritesChanged || oldChannel.name !== newChannel.name || (oldChannel.topic ?? null) !== (newChannel.topic ?? null) || Boolean(oldChannel.nsfw) !== Boolean(newChannel.nsfw);
    if (!changed) return;
    const everyoneId = newChannel.guild.id;
    const gained = overwritesChanged
      ? gainedFlags(before.find((o) => o.id === everyoneId)?.allow ?? 0, after.find((o) => o.id === everyoneId)?.allow ?? 0, DANGEROUS_CHANNEL_FLAGS)
      : [];
    const lang = currentLanguage();
    return track(newChannel.client, newChannel.guild, {
      rule: 'channel_update',
      auditLogType: TYPES,
      targetId: newChannel.id,
      immediate: gained.length > 0,
      actionLabel: gained.length
        ? t(lang, 'security.antinuke.detail.channelOpened', { channel: oldChannel.name, permissions: gained.join(', ') })
        : t(lang, 'security.antinuke.detail.channelUpdate', { channel: oldChannel.name }),
      inline: [{ kind: 'revert_channel', id: oldChannel.id, name: oldChannel.name, topic: oldChannel.topic ?? undefined, nsfw: Boolean(oldChannel.nsfw), overwrites: before }],
    }).catch((err) => logger.error('Anti-nuke channel-update tracking failed:', err));
  },
};

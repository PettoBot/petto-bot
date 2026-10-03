// The welcome of a new Partner Manager: it goes to the welcome channel of the server when there is one, and otherwise to the
// channel it was asked in. Used by `!partnerconfig welcome` and when the manager role is given to someone.
const { responsePayload } = require('./partnerMessages');

/** Sends the welcome; false when there is no channel to send it to. */
async function sendManagerWelcome({ guild, member, config, fallbackChannel = null }) {
  const configured = config.welcome_channel_id ? await guild.channels.fetch(config.welcome_channel_id).catch(() => null) : null;
  const channel = configured?.isTextBased?.() ? configured : fallbackChannel;
  if (!channel?.send) return false;
  const payload = await responsePayload(guild.id, config, 'manager_welcome', { guild, member, user: member.user, channel, partner: {} });
  const sent = await channel.send({ ...payload, allowedMentions: { users: [member.id] } }).catch(() => null);
  return Boolean(sent);
}

module.exports = { sendManagerWelcome };

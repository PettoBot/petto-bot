// i18n-ignore-file: internal helper, nothing is shown to anybody here
// Discord hides the channels a bot cannot view (`VIEW_CHANNEL`): the bot still hears of them, but with the name `___hidden___`, no topic or permission overwrites, and the
// flag `CHANNEL_OBFUSCATED` (1 << 17); only the id, the type, the position and the category are real. A copy of the server or a list of channels must not take them as they are.
const CHANNEL_OBFUSCATED = 1 << 17;
const HIDDEN_NAME = '___hidden___';

/** Whether this channel is one Discord shows the bot only in outline. */
function isObfuscatedChannel(channel) {
  if (!channel) return false;
  const flags = Number(channel.flags?.bitfield ?? channel.flags ?? 0);
  return (Number.isFinite(flags) && (flags & CHANNEL_OBFUSCATED) !== 0) || channel.name === HIDDEN_NAME;
}

/** The channels that the bot can really read, from a collection or a list. */
function visibleChannels(channels) {
  return [...channels].filter((channel) => !isObfuscatedChannel(channel));
}

/** How many of the channels are hidden from the bot. */
function countObfuscated(channels) {
  return [...channels].filter(isObfuscatedChannel).length;
}

module.exports = { CHANNEL_OBFUSCATED, HIDDEN_NAME, isObfuscatedChannel, visibleChannels, countObfuscated };

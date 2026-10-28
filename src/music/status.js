// i18n-ignore-file: the status of a voice channel is the title and the artist of the song, not a message of Petto.
// The status of the voice channel ("🎵 Song - Artist", shown under its name). It needs the permission "Set Voice Channel Status" in that channel; a server that did
// not give it is told once in the log and the music goes on without it.
const logger = require('../utils/logger');
const icons = require('./icons');

const MAX = 450;
const missing = new Set(); // channels where the permission is missing

const clip = (text) => (text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text);

/** Writes (or, with `null`, clears) the status of a voice channel. Never throws. */
async function setVoiceStatus(client, channelId, text) {
  if (!channelId || (missing.has(channelId) && text)) return false;
  try {
    await client.rest.put(`/channels/${channelId}/voice-status`, { body: { status: text ? clip(text) : '' } });
    missing.delete(channelId);
    return true;
  } catch (error) {
    if (error?.code === 50013 || error?.status === 403) {
      if (!missing.has(channelId)) logger.info(`Music: no permission to set the status of the voice channel ${channelId}`);
      missing.add(channelId);
    } else if (error?.status !== 404) {
      logger.warn(`Music: could not set the status of a voice channel: ${error?.message ?? error}`);
    }
    return false;
  }
}

const statusOf = (item) => `${icons.NOTE} ${[item.title, item.author].filter(Boolean).join(' - ')}`;

module.exports = { setVoiceStatus, statusOf };

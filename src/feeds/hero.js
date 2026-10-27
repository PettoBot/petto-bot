// The picture that heads the card of a release (a song, an album, an episode of a podcast): the cover next to a panel with the same cover blurred behind
// the title and the artist, drawn by the same code as the card of `!deezer`. It is one attachment sent with the message. When it cannot be drawn
// (the cover does not load) the card is the ordinary one.
const { AttachmentBuilder } = require('discord.js');
const { buildSongCard } = require('../imgutils/songCard');
const logger = require('../utils/logger');

const FILE_NAME = 'release.png';
const HERO_TYPES = new Set(['release']);

/** `{ name, files }` for an item that gets the picture, or null (another kind of notice, or no cover, or it could not be drawn). */
async function heroFor(item) {
  if (!HERO_TYPES.has(item?.type) || !/^https:\/\//i.test(String(item.image ?? ''))) return null;
  try {
    const buffer = await buildSongCard({ coverUrl: item.image, title: String(item.title ?? ''), subtitle: String(item.author ?? ''), detail: String(item.extra ?? ''), round: false });
    return { name: FILE_NAME, files: [new AttachmentBuilder(buffer, { name: FILE_NAME })] };
  } catch (error) {
    logger.warn(`The picture of a release could not be drawn: ${error?.message ?? error}`);
    return null;
  }
}

module.exports = { heroFor, FILE_NAME, HERO_TYPES };

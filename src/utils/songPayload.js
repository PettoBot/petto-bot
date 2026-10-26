// The card of a song, an album or an artist: the picture of `imgutils/songCard` as the heading (one attachment), with the rest of the card under it.
// When the picture cannot be drawn, the card is the ordinary one with the cover as its banner.
const { AttachmentBuilder } = require('discord.js');
const { infoPayload } = require('./infoCard');
const logger = require('./logger');
const { buildSongCard } = require('../imgutils/songCard');

const FILE_NAME = 'song.png';

/**
 * @param {object} options  The options of `infoPayload` (sections, footer, buttons...) plus:
 * @param {string} options.title      Song, album or artist (drawn on the picture).
 * @param {string} [options.artist]   The second line of the picture.
 * @param {string} [options.detail]   The third line.
 * @param {string|null} [options.cover]  The cover, an https link.
 * @param {boolean} [options.round]   The cover as a circle (an artist).
 */
async function songPayload({ title, artist = '', detail = '', cover = null, round = false, ...card }) {
  try {
    const buffer = await buildSongCard({ coverUrl: cover, title, subtitle: artist, detail, round });
    return { ...infoPayload({ accent: null, title, hero: `attachment://${FILE_NAME}`, ...card }), files: [new AttachmentBuilder(buffer, { name: FILE_NAME })] };
  } catch (error) {
    logger.warn(`The picture of a song could not be drawn: ${error?.message ?? error}`);
    return infoPayload({ accent: null, title, subtitle: [artist, detail].filter(Boolean), banner: cover, ...card });
  }
}

module.exports = { songPayload, FILE_NAME };

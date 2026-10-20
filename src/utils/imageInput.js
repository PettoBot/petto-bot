// Finds the picture an image command works on and loads it safely. In order: a file sent with the command, a file or embed image
// of the message it replies to, a link typed after it, a member's avatar (mention, ID or name), the author of the replied
// message, and the avatar of whoever ran the command. Downloads go through safeImage (https only, public addresses only, a time
// limit, image types only), are limited to 8 MB, and the size of the picture is read from its first bytes before it is decoded.
const { loadImage } = require('@napi-rs/canvas');
const { fetchImageBuffer } = require('./safeImage');
const { resolveUser } = require('./userResolve');

const INPUT_LIMITS = { bytes: 8 * 1024 * 1024, pixels: 16_777_216, side: 8192 };
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)\b/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)(?:$|[?#])/i;

/** An error whose message is meant for the member (a key of the `images` texts and its values). */
class ImageInputError extends Error {
  constructor(key, vars = {}) {
    super(key);
    this.key = key;
    this.vars = vars;
  }
}

/** The width, height and type of a PNG, JPEG, GIF or WebP from its first bytes, or null when they cannot be read. */
function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47 && buffer.length >= 24) return { type: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return { type: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.length >= 30) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { type: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const [b0, b1, b2, b3] = [buffer[21], buffer[22], buffer[23], buffer[24]];
      return { type: 'webp', width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      // A start-of-frame marker holds the size (all of C0-CF except C4, C8 and CC, which are tables).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
    return null;
  }
  return null;
}

/** Downloads and decodes an image link within the limits: `{ image, gif }`. Throws an ImageInputError the member can read. */
async function loadInputImage(url, { fetch = fetchImageBuffer } = {}) {
  let buffer;
  try {
    buffer = await fetch(url, undefined, { maxBytes: INPUT_LIMITS.bytes });
  } catch (err) {
    if (/too large/i.test(err.message)) throw new ImageInputError('images.error.tooLarge', { mb: INPUT_LIMITS.bytes / 1024 / 1024 });
    if (/not a PNG/i.test(err.message)) throw new ImageInputError('images.error.notImage');
    throw new ImageInputError('images.error.download');
  }
  const size = imageDimensions(buffer);
  if (!size) throw new ImageInputError('images.error.notImage');
  if (!size.width || !size.height || size.width > INPUT_LIMITS.side || size.height > INPUT_LIMITS.side || size.width * size.height > INPUT_LIMITS.pixels) {
    throw new ImageInputError('images.error.tooManyPixels', { side: INPUT_LIMITS.side });
  }
  try {
    return { image: await loadImage(buffer), gif: size.type === 'gif' };
  } catch {
    throw new ImageInputError('images.error.notImage');
  }
}

/** The link of the first image file of a message, or of an image in one of its embeds. */
function imageOfMessage(message) {
  if (!message) return null;
  for (const file of message.attachments?.values?.() ?? []) {
    if (IMAGE_TYPES.test(file.contentType ?? '') || (!file.contentType && IMAGE_EXTENSION.test(file.name ?? ''))) return { url: file.url, size: file.size ?? 0 };
  }
  for (const embed of message.embeds ?? []) {
    const url = embed.image?.url ?? embed.thumbnail?.url ?? (embed.data?.type === 'image' ? embed.url : null);
    if (url) return { url, size: 0 };
  }
  for (const sticker of message.stickers?.values?.() ?? []) {
    // PNG and APNG stickers have a picture; Lottie ones (format 3) do not.
    if (sticker.format !== 3 && sticker.url) return { url: sticker.url, size: 0 };
  }
  return null;
}

const LINK = /^<?(https?:\/\/[^\s<>]+)>?$/i;

/** The avatar link of a user, as the member of this server when they have a server avatar. */
function avatarUrl(guild, user) {
  const member = guild?.members?.cache?.get(user.id);
  return (member ?? user).displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true });
}

/**
 * Where the picture comes from: `{ url, source }`, `source` being attachment, reply, link, member, replyAuthor or self. `message` is
 * the message of the command, `replied` the message it answers (or null) and `text` what was typed for the picture.
 */
async function findImageSource({ message, replied = null, text = '' }) {
  const own = imageOfMessage({ attachments: message.attachments, embeds: [], stickers: message.stickers });
  if (own) return checkSize({ ...own, source: 'attachment' });
  const inReply = imageOfMessage(replied);
  if (inReply) return checkSize({ ...inReply, source: 'reply' });
  const typed = String(text ?? '').trim();
  if (typed) {
    const link = LINK.exec(typed);
    if (link) {
      if (!/^https:/i.test(link[1])) throw new ImageInputError('images.error.httpsOnly');
      return { url: link[1], source: 'link' };
    }
    const user = await resolveUser(message.client, typed, message.guild).catch(() => null);
    if (!user) throw new ImageInputError('images.error.noSource', { input: typed.slice(0, 80) });
    return { url: avatarUrl(message.guild, user), source: 'member', user };
  }
  if (replied?.author) return { url: avatarUrl(message.guild, replied.author), source: 'replyAuthor', user: replied.author };
  return { url: avatarUrl(message.guild, message.author), source: 'self', user: message.author };
}

function checkSize(found) {
  if (found.size > INPUT_LIMITS.bytes) throw new ImageInputError('images.error.tooLarge', { mb: INPUT_LIMITS.bytes / 1024 / 1024 });
  return found;
}

module.exports = { INPUT_LIMITS, ImageInputError, imageDimensions, loadInputImage, imageOfMessage, findImageSource, avatarUrl };

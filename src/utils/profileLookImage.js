// i18n-ignore-file: nothing here is shown to anyone; a picture that cannot be drawn is simply left out
// The picture of a profile as Discord shows it: the avatar in a circle with its decoration around it. It is what `!userinfo` and
// `!usercosmetics` put in their cards, so the decoration is seen and not only linked. A decoration that moves gives an animated PNG.
const { createCanvas } = require('@napi-rs/canvas');
const { fetchImageBuffer, decode, loadImageFromLink } = require('./safeImage');
const { decodeApng, encodeApng } = require('../imgutils/apng');
const { decorationUrl, animatedDecorationUrl } = require('./profileLook');

const AVATAR = 240;
// The decoration is a fifth bigger than the avatar, like in Discord.
const FULL = Math.round(AVATAR * 1.2);
const MAX_FRAMES = 30;
const MAX_BYTES = 2 * 1024 * 1024;
const FILE_NAME = 'look.png';

function drawBase(ctx, avatar) {
  const offset = (FULL - AVATAR) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(FULL / 2, FULL / 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, offset, offset, AVATAR, AVATAR);
  else { ctx.fillStyle = '#2b2d31'; ctx.fillRect(offset, offset, AVATAR, AVATAR); }
  ctx.restore();
}

function frameBuffer(avatar, decoration) {
  const canvas = createCanvas(FULL, FULL);
  const ctx = canvas.getContext('2d');
  drawBase(ctx, avatar);
  if (decoration) ctx.drawImage(decoration, 0, 0, FULL, FULL);
  return canvas.toBuffer('image/png');
}

/**
 * `{ buffer, name, moving }` with the avatar and its decoration, or null when the person has no decoration (the plain avatar is
 * then enough). `moving` asks for the animated picture when the decoration moves. It never throws.
 */
async function renderProfileLook(user, { member = null, moving = false } = {}) {
  const still = decorationUrl(user);
  if (!still) return null;
  try {
    const target = member ?? user;
    const avatar = await loadImageFromLink(target.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }));
    const animatedLink = moving ? animatedDecorationUrl(user) : '';
    if (animatedLink) {
      try {
        const frames = await decodeApng(await fetchImageBuffer(animatedLink, undefined, { maxBytes: MAX_BYTES }));
        if (frames?.length > 1) {
          const step = Math.max(1, Math.ceil(frames.length / MAX_FRAMES));
          const picked = [];
          for (let at = 0; at < frames.length; at += step) picked.push({ canvas: frames[at].canvas, delayMs: frames.slice(at, at + step).reduce((sum, f) => sum + f.delayMs, 0) });
          const [first, ...rest] = picked.map((frame) => ({ png: frameBuffer(avatar, frame.canvas), delayMs: frame.delayMs }));
          const buffer = encodeApng(first, rest.map((frame) => ({ ...frame, x: 0, y: 0 })));
          if (buffer.length <= 6 * 1024 * 1024) return { buffer, name: FILE_NAME, moving: true };
        }
      } catch { /* The still picture below is what is sent. */ }
    }
    const decoration = await decode(await fetchImageBuffer(still, undefined, { maxBytes: MAX_BYTES }));
    return { buffer: frameBuffer(avatar, decoration), name: FILE_NAME, moving: false };
  } catch {
    return null;
  }
}

module.exports = { renderProfileLook, FILE_NAME };

// i18n-ignore-file: nothing here is shown to anyone; a picture that cannot be drawn is simply left out
// The picture of a profile as Discord shows it: the avatar in a circle with its decoration around it. It is what `!userinfo` and
// `!usercosmetics` put in their cards, so the decoration is seen and not only linked. A decoration that moves gives an animated PNG.
const { createCanvas } = require('@napi-rs/canvas');
const { fetchImageBuffer, decode, loadImageFromLink } = require('./safeImage');
const { decodeApng, encodeApng } = require('../imgutils/apng');
const { decorationUrl, animatedDecorationUrl, nameplateUrl, serverTag, serverTagBadge } = require('./profileLook');
const { normalizeCard } = require('./cardSchema');
const { renderCard } = require('../imgutils/cardRenderer');

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

// The row of a profile as Discord shows it, in one wide picture: the nameplate behind, the avatar with its decoration on the left, then the
// name with the server tag. It is drawn with the image card engine, so a decoration that moves gives an animated PNG.
const ROW = { width: 1200, height: 300, background: '#2b2d31' };
const ROW_FILE = 'cosmetics.png';

function rowCard({ name, nameplate, decoration, tag, badge, moving }) {
  const margin = 24;
  const w = ROW.width - margin * 2;
  const h = ROW.height - margin * 2;
  const avatarX = margin + 40 + 90;
  const nameX = avatarX + 90 + 56;
  const layers = [{ id: 'panel', type: 'shape', shape: 'rect', x: ROW.width / 2, y: ROW.height / 2, w, h, fill: '#1e1f22', radius: 44, opacity: 1 }];
  if (nameplate) layers.push({ id: 'nameplate', type: 'image', src: nameplate, x: ROW.width / 2, y: ROW.height / 2, w, h, fit: 'cover', radius: 44, opacity: 1 });
  layers.push({ id: 'avatar', type: 'avatar', source: 'user', x: avatarX, y: ROW.height / 2, size: 180, shape: 'circle', border: null, shadow: { color: '#000000', blur: 16, x: 0, y: 4 } });
  if (decoration) layers.push({ id: 'decoration', type: 'image', src: decoration, x: avatarX, y: ROW.height / 2, w: 216, h: 216, fit: 'contain', radius: 0, opacity: 1, ...(moving ? { animate: true } : {}) });
  layers.push({ id: 'name', type: 'text', text: name, x: nameX, y: ROW.height / 2, size: 56, font: 'Poppins', weight: 800, color: '#ffffff', align: 'left', w: 520, maxLines: 1 });
  if (badge) layers.push({ id: 'badge', type: 'image', src: badge, x: nameX, y: ROW.height / 2, w: 58, h: 58, fit: 'contain', radius: 0, opacity: 1, follow: 'name', gap: 22 });
  if (tag) layers.push({ id: 'tag', type: 'text', text: tag, x: nameX, y: ROW.height / 2, size: 34, font: 'Poppins', weight: 700, color: '#ffffff', align: 'left', shadow: null, follow: badge ? 'badge,name' : 'name', gap: 18, pill: { color: '#ffffff', opacity: 0.2, padX: 20, padY: 8, radius: 999 } });
  return { mode: 'advanced', width: ROW.width, height: ROW.height, background: { color: ROW.background }, layers };
}

/**
 * `{ buffer, name, moving }`: the whole row of a profile in one picture, with the nameplate, the avatar with its decoration, the name and
 * the server tag. Each part is only drawn when the person has it. `moving` asks for the animated PNG when the decoration moves.
 * It returns null when the picture cannot be drawn.
 */
async function renderCosmeticsImage(user, { member = null, moving = false, name = null } = {}) {
  try {
    const target = member ?? user;
    const decoration = decorationUrl(user);
    const animates = moving && Boolean(animatedDecorationUrl(user));
    const { card } = normalizeCard(rowCard({
      name: String(name ?? member?.displayName ?? user.globalName ?? user.username ?? '').slice(0, 60),
      nameplate: nameplateUrl(user), decoration, tag: serverTag(user), badge: serverTagBadge(user), moving: animates,
    }), { premium: true });
    const buffer = await renderCard(card, {
      resolveText: async (value) => value,
      avatar: async () => loadImageFromLink(target.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true })),
      loadSource: async (src) => loadImageFromLink(src),
      loadFrames: animates ? async (src) => {
        try { return await decodeApng(await fetchImageBuffer(src.replace('passthrough=false', 'passthrough=true'), undefined, { maxBytes: MAX_BYTES })); } catch { return null; }
      } : undefined,
    });
    return { buffer, name: ROW_FILE, moving: animates && readsAsAnimation(buffer) };
  } catch {
    return null;
  }
}

/** True when the PNG has the animation chunk, so the caller can say whether it moves. */
function readsAsAnimation(buffer) {
  try { return require('../imgutils/apng').readChunks(buffer).some((chunk) => chunk.type === 'acTL'); } catch { return false; }
}

module.exports = { renderProfileLook, renderCosmeticsImage, FILE_NAME, ROW_FILE };

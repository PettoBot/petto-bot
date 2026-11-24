// i18n-ignore-file: the answers are codes; the website writes the words.
// The animated own picture of a Gold plan: a GIF is cut to what the card needs (every frame cropped to the shape of the banner and made small), kept as an APNG, which is what the card
// draws and what the team sees. A picture that is not a GIF is not touched here. Written in TypeScript: `npm run build:ts` compiles it over animatedPicture.js.
const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const gif = require('../imgutils/gif') as typeof import('../imgutils/gif');
const apng = require('../imgutils/apng') as { encodeApng(first: { png: Buffer; delayMs: number }, parts: { png: Buffer; x: number; y: number; delayMs: number }[]): Buffer; decodeApng(buffer: Buffer, options?: { maxFrames?: number; maxSide?: number }): Promise<{ canvas: import('@napi-rs/canvas').Canvas; delayMs: number }[] | null> };
const { MIN_SOURCE_WIDTH, MIN_SOURCE_HEIGHT } = require('./shopImages') as typeof import('./shopImages');

/** Every frame is kept at half the size of the still banner (1024 x 320), so a card that moves stays small. */
export const ANIMATED_WIDTH = 512;
export const ANIMATED_HEIGHT = 160;
export const MAX_ANIMATED_FRAMES = 30;
export const MAX_ANIMATED_STORED = 3 * 1024 * 1024;

export type AnimatedResult = { ok: true; bytes: Buffer; still: Buffer; frames: number } | { ok: false; error: 'bad_file' | 'file_too_small' | 'too_big' | 'not_animated' };

export async function normalizeAnimated(bytes: Buffer): Promise<AnimatedResult> {
  let picture: ReturnType<typeof gif.decodeGif>;
  try { picture = gif.decodeGif(bytes); } catch { return { ok: false, error: 'bad_file' }; }
  if (!picture) return { ok: false, error: 'not_animated' };
  if (picture.width < MIN_SOURCE_WIDTH || picture.height < MIN_SOURCE_HEIGHT) return { ok: false, error: 'file_too_small' };
  const scale = Math.max(ANIMATED_WIDTH / picture.width, ANIMATED_HEIGHT / picture.height);
  const width = picture.width * scale, height = picture.height * scale;
  const small = picture.frames.map((frame) => {
    const canvas = createCanvas(ANIMATED_WIDTH, ANIMATED_HEIGHT);
    canvas.getContext('2d').drawImage(frame.canvas, (ANIMATED_WIDTH - width) / 2, (ANIMATED_HEIGHT - height) / 2, width, height);
    return { canvas, delayMs: frame.delayMs };
  });
  // A long animation is cut to the frames the card can carry, each one lasting as long as the ones it replaces. If it is still too big, it loses half of its frames until it fits.
  let frames = small;
  for (;;) {
    const step = Math.max(1, Math.ceil(frames.length / MAX_ANIMATED_FRAMES));
    const picked: typeof small = [];
    for (let at = 0; at < frames.length; at += step) {
      const group = frames.slice(at, at + step);
      picked.push({ canvas: group[0].canvas, delayMs: group.reduce((sum, f) => sum + f.delayMs, 0) });
    }
    frames = picked;
    const png = (frame: (typeof small)[number]) => frame.canvas.toBuffer('image/png');
    const out = apng.encodeApng({ png: png(frames[0]), delayMs: frames[0].delayMs }, frames.slice(1).map((frame) => ({ png: png(frame), x: 0, y: 0, delayMs: frame.delayMs })));
    if (out.length <= MAX_ANIMATED_STORED) {
      // The first frame, at the size of a still banner, is what the detector looks at and what a card shows when the plan ends.
      const fit = Math.max(1024 / picture.width, 320 / picture.height);
      const still = createCanvas(1024, 320);
      still.getContext('2d').drawImage(picture.frames[0].canvas, (1024 - picture.width * fit) / 2, (320 - picture.height * fit) / 2, picture.width * fit, picture.height * fit);
      return { ok: true, bytes: out, still: still.toBuffer('image/webp', 90), frames: frames.length };
    }
    if (frames.length < 6) return { ok: false, error: 'too_big' };
    frames = frames.filter((_, index) => index % 2 === 0);
  }
}

/** True when the bytes are an APNG (a picture that moves), as the ones kept here. */
export function isAnimated(bytes: Buffer): boolean {
  try { return (require('../imgutils/apng') as { readChunks(buffer: Buffer): { type: string }[] }).readChunks(bytes).some((chunk) => chunk.type === 'acTL'); } catch { return false; }
}

/** The frames of a kept animation as whole pictures, or null when it does not move or cannot be read. Never throws. */
export async function framesOf(bytes: Buffer) {
  try { return await apng.decodeApng(bytes, { maxFrames: MAX_ANIMATED_FRAMES + 2, maxSide: 1100 }); } catch { return null; }
}

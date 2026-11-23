// i18n-ignore-file: the answers are codes; the editor of the website writes the words.
// The banners of the shop are all the same size, so they look right everywhere: on the profile picture, on the rank card, and in the shop. Whatever the owner uploads is
// cut to the middle of the picture (as a background is, "cover") and saved as a 1024 x 320 WebP, so a tall or a very wide picture is never stretched.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopImages.js.
const { createCanvas, loadImage } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');

/** The size every banner is saved at (the rank card is 1024 x 320; the profile picture shows the middle 1024 x 250 of it). */
export const BANNER_WIDTH = 1024;
export const BANNER_HEIGHT = 320;
/** A picture smaller than this is refused: it would look blurry when it is stretched to the banner. */
export const MIN_SOURCE_WIDTH = 800;
export const MIN_SOURCE_HEIGHT = 200;

export type Normalized = { ok: true; bytes: Buffer; type: 'image/webp' } | { ok: false; error: 'bad_file' | 'file_too_small' };

/** Cuts a picture to 1024 x 320 (the middle of it, never stretched) and saves it as WebP. */
export async function normalizeBanner(bytes: Buffer): Promise<Normalized> {
  let image;
  try { image = await loadImage(bytes); } catch { return { ok: false, error: 'bad_file' }; }
  if (image.width < MIN_SOURCE_WIDTH || image.height < MIN_SOURCE_HEIGHT) return { ok: false, error: 'file_too_small' };
  const canvas = createCanvas(BANNER_WIDTH, BANNER_HEIGHT);
  const ctx = canvas.getContext('2d');
  const scale = Math.max(BANNER_WIDTH / image.width, BANNER_HEIGHT / image.height);
  const width = image.width * scale, height = image.height * scale;
  ctx.drawImage(image, (BANNER_WIDTH - width) / 2, (BANNER_HEIGHT - height) / 2, width, height);
  return { ok: true, bytes: canvas.toBuffer('image/webp', 90), type: 'image/webp' };
}

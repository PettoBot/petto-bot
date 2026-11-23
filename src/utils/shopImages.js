"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_SOURCE_HEIGHT = exports.MIN_SOURCE_WIDTH = exports.BANNER_HEIGHT = exports.BANNER_WIDTH = void 0;
exports.normalizeBanner = normalizeBanner;
// i18n-ignore-file: the answers are codes; the editor of the website writes the words.
// The banners of the shop are all the same size, so they look right everywhere: on the profile picture, on the rank card, and in the shop. Whatever the owner uploads is
// cut to the middle of the picture (as a background is, "cover") and saved as a 1024 x 320 WebP, so a tall or a very wide picture is never stretched.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopImages.js.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
/** The size every banner is saved at (the rank card is 1024 x 320; the profile picture shows the middle 1024 x 250 of it). */
exports.BANNER_WIDTH = 1024;
exports.BANNER_HEIGHT = 320;
/** A picture smaller than this is refused: it would look blurry when it is stretched to the banner. */
exports.MIN_SOURCE_WIDTH = 800;
exports.MIN_SOURCE_HEIGHT = 200;
/** Cuts a picture to 1024 x 320 (the middle of it, never stretched) and saves it as WebP. */
async function normalizeBanner(bytes) {
    let image;
    try {
        image = await loadImage(bytes);
    }
    catch {
        return { ok: false, error: 'bad_file' };
    }
    if (image.width < exports.MIN_SOURCE_WIDTH || image.height < exports.MIN_SOURCE_HEIGHT)
        return { ok: false, error: 'file_too_small' };
    const canvas = createCanvas(exports.BANNER_WIDTH, exports.BANNER_HEIGHT);
    const ctx = canvas.getContext('2d');
    const scale = Math.max(exports.BANNER_WIDTH / image.width, exports.BANNER_HEIGHT / image.height);
    const width = image.width * scale, height = image.height * scale;
    ctx.drawImage(image, (exports.BANNER_WIDTH - width) / 2, (exports.BANNER_HEIGHT - height) / 2, width, height);
    return { ok: true, bytes: canvas.toBuffer('image/webp', 90), type: 'image/webp' };
}

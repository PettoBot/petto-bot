"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ANIMATED_STORED = exports.MAX_ANIMATED_FRAMES = exports.ANIMATED_HEIGHT = exports.ANIMATED_WIDTH = void 0;
exports.normalizeAnimated = normalizeAnimated;
exports.isAnimated = isAnimated;
exports.framesOf = framesOf;
// i18n-ignore-file: the answers are codes; the website writes the words.
// The animated own picture of a Gold plan: a GIF is cut to what the card needs (every frame cropped to the shape of the banner and made small), kept as an APNG, which is what the card
// draws and what the team sees. A picture that is not a GIF is not touched here. Written in TypeScript: `npm run build:ts` compiles it over animatedPicture.js.
const { createCanvas } = require('@napi-rs/canvas');
const gif = require('../imgutils/gif');
const apng = require('../imgutils/apng');
const { MIN_SOURCE_WIDTH, MIN_SOURCE_HEIGHT } = require('./shopImages');
/** Every frame is kept at half the size of the still banner (1024 x 320), so a card that moves stays small. */
exports.ANIMATED_WIDTH = 512;
exports.ANIMATED_HEIGHT = 160;
exports.MAX_ANIMATED_FRAMES = 30;
exports.MAX_ANIMATED_STORED = 3 * 1024 * 1024;
async function normalizeAnimated(bytes) {
    let picture;
    try {
        picture = gif.decodeGif(bytes);
    }
    catch {
        return { ok: false, error: 'bad_file' };
    }
    if (!picture)
        return { ok: false, error: 'not_animated' };
    if (picture.width < MIN_SOURCE_WIDTH || picture.height < MIN_SOURCE_HEIGHT)
        return { ok: false, error: 'file_too_small' };
    const scale = Math.max(exports.ANIMATED_WIDTH / picture.width, exports.ANIMATED_HEIGHT / picture.height);
    const width = picture.width * scale, height = picture.height * scale;
    const small = picture.frames.map((frame) => {
        const canvas = createCanvas(exports.ANIMATED_WIDTH, exports.ANIMATED_HEIGHT);
        canvas.getContext('2d').drawImage(frame.canvas, (exports.ANIMATED_WIDTH - width) / 2, (exports.ANIMATED_HEIGHT - height) / 2, width, height);
        return { canvas, delayMs: frame.delayMs };
    });
    // A long animation is cut to the frames the card can carry, each one lasting as long as the ones it replaces. If it is still too big, it loses half of its frames until it fits.
    let frames = small;
    for (;;) {
        const step = Math.max(1, Math.ceil(frames.length / exports.MAX_ANIMATED_FRAMES));
        const picked = [];
        for (let at = 0; at < frames.length; at += step) {
            const group = frames.slice(at, at + step);
            picked.push({ canvas: group[0].canvas, delayMs: group.reduce((sum, f) => sum + f.delayMs, 0) });
        }
        frames = picked;
        const png = (frame) => frame.canvas.toBuffer('image/png');
        const out = apng.encodeApng({ png: png(frames[0]), delayMs: frames[0].delayMs }, frames.slice(1).map((frame) => ({ png: png(frame), x: 0, y: 0, delayMs: frame.delayMs })));
        if (out.length <= exports.MAX_ANIMATED_STORED) {
            // The first frame, at the size of a still banner, is what the detector looks at and what a card shows when the plan ends.
            const fit = Math.max(1024 / picture.width, 320 / picture.height);
            const still = createCanvas(1024, 320);
            still.getContext('2d').drawImage(picture.frames[0].canvas, (1024 - picture.width * fit) / 2, (320 - picture.height * fit) / 2, picture.width * fit, picture.height * fit);
            // The detector looks at up to five frames spread over the whole animation (the first, the last and the ones between), not only at the first one.
            const count = Math.min(5, frames.length);
            const samples = Array.from({ length: count }, (_, index) => png(frames[Math.round((index * (frames.length - 1)) / Math.max(1, count - 1))]));
            return { ok: true, bytes: out, still: still.toBuffer('image/webp', 90), samples, frames: frames.length };
        }
        if (frames.length < 6)
            return { ok: false, error: 'too_big' };
        frames = frames.filter((_, index) => index % 2 === 0);
    }
}
/** True when the bytes are an APNG (a picture that moves), as the ones kept here. */
function isAnimated(bytes) {
    try {
        return require('../imgutils/apng').readChunks(bytes).some((chunk) => chunk.type === 'acTL');
    }
    catch {
        return false;
    }
}
/** The frames of a kept animation as whole pictures, or null when it does not move or cannot be read. Never throws. */
async function framesOf(bytes) {
    try {
        return await apng.decodeApng(bytes, { maxFrames: exports.MAX_ANIMATED_FRAMES + 2, maxSide: 1100 });
    }
    catch {
        return null;
    }
}

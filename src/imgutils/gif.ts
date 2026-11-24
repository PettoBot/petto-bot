// i18n-ignore-file: these errors are only logged or turned into a code, never shown to anyone
// An animated GIF, read by hand: the own picture of a Gold plan may move, and the card needs its frames as whole pictures. Only what the card needs is read: the size, the
// frames (put together following their disposal rules, with the transparent colour) and how long each one lasts. Written in TypeScript: `npm run build:ts` compiles it over gif.js.
const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');

export const GIF_LIMITS = { frames: 120, side: 2048, pixels: 160_000_000, minDelayMs: 30, maxDelayMs: 2000 };
export interface GifFrame { canvas: import('@napi-rs/canvas').Canvas; delayMs: number }
export interface GifPicture { width: number; height: number; frames: GifFrame[] }

/** True when the bytes start like a GIF. */
export const isGif = (bytes: Buffer): boolean => bytes.length > 13 && (bytes.toString('latin1', 0, 6) === 'GIF87a' || bytes.toString('latin1', 0, 6) === 'GIF89a');

/** The indexes of a compressed block of an image (LZW), `size` of them. It throws on a broken stream. */
function lzw(data: Buffer, minCode: number, size: number): Uint8Array {
  if (minCode < 2 || minCode > 8) throw new Error('A broken GIF.');
  const clear = 1 << minCode, end = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  const out = new Uint8Array(size);
  let codeSize = minCode + 1, next = end + 1, old = -1, first = 0, written = 0, bits = 0, count = 0, at = 0, top = 0;
  for (let i = 0; i < clear; i += 1) suffix[i] = i;
  while (written < size) {
    while (count < codeSize) { if (at >= data.length) return out; bits |= data[at++] << count; count += 8; }
    const code = bits & ((1 << codeSize) - 1);
    bits >>= codeSize; count -= codeSize;
    if (code === clear) { codeSize = minCode + 1; next = end + 1; old = -1; continue; }
    if (code === end) break;
    if (old === -1) { if (code >= clear) throw new Error('A broken GIF.'); out[written++] = suffix[code]; old = code; first = code; continue; }
    let current = code;
    if (code >= next) { if (code > next) throw new Error('A broken GIF.'); stack[top++] = first; current = old; }
    while (current >= clear) { if (top > 4095) throw new Error('A broken GIF.'); stack[top++] = suffix[current]; current = prefix[current]; }
    first = suffix[current];
    stack[top++] = first;
    if (next < 4096) { prefix[next] = old; suffix[next] = first; next += 1; if (next === (1 << codeSize) && codeSize < 12) codeSize += 1; }
    old = code;
    while (top > 0 && written < size) out[written++] = stack[--top];
    top = 0;
  }
  return out;
}

/** The frames of a GIF as whole pictures, or null when it is a single picture. It throws on a file that is not a GIF, is broken or is too big. */
export function decodeGif(bytes: Buffer, limits: Partial<typeof GIF_LIMITS> = {}): GifPicture | null {
  const max = { ...GIF_LIMITS, ...limits };
  if (!isGif(bytes)) throw new Error('Not a GIF.');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (!width || !height || width > max.side || height > max.side) throw new Error('That GIF is too large.');
  const flags = bytes[10], background = bytes[11];
  let at = 13;
  let globalTable: Buffer | null = null;
  if (flags & 0x80) { const length = 3 * (1 << ((flags & 7) + 1)); globalTable = bytes.subarray(at, at + length); at += length; }

  const whole = createCanvas(width, height);
  const wholeCtx = whole.getContext('2d');
  const frames: GifFrame[] = [];
  let control: { disposal: number; delayMs: number; transparent: number } = { disposal: 0, delayMs: 100, transparent: -1 };
  void background;
  while (at < bytes.length) {
    const block = bytes[at++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9 && bytes[at] >= 4) {
        const packed = bytes[at + 1];
        control = { disposal: (packed >> 2) & 7, delayMs: bytes.readUInt16LE(at + 2) * 10, transparent: packed & 1 ? bytes[at + 4] : -1 };
      }
      while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
      at += 1;
      continue;
    }
    if (block !== 0x2c) throw new Error('A broken GIF.');
    const x = bytes.readUInt16LE(at), y = bytes.readUInt16LE(at + 2), w = bytes.readUInt16LE(at + 4), h = bytes.readUInt16LE(at + 6), local = bytes[at + 8];
    at += 9;
    if (!w || !h || x + w > width || y + h > height) throw new Error('A frame outside the picture.');
    let table = globalTable;
    if (local & 0x80) { const length = 3 * (1 << ((local & 7) + 1)); table = bytes.subarray(at, at + length); at += length; }
    if (!table) throw new Error('A GIF without colours.');
    const minCode = bytes[at++];
    const chunks: Buffer[] = [];
    while (at < bytes.length && bytes[at] !== 0) { chunks.push(bytes.subarray(at + 1, at + 1 + bytes[at])); at += bytes[at] + 1; }
    at += 1;
    if (frames.length >= max.frames) throw new Error('That GIF has too many frames.');
    if ((frames.length + 1) * width * height > max.pixels) throw new Error('That GIF is too big.');
    const indexes = lzw(Buffer.concat(chunks), minCode, w * h);
    const picture = wholeCtx.createImageData(w, h);
    const order: number[] = [];
    if (local & 0x40) {
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let row = start; row < h; row += step) order.push(row);
    } else for (let row = 0; row < h; row += 1) order.push(row);
    for (let line = 0; line < h; line += 1) {
      const row = order[line];
      for (let column = 0; column < w; column += 1) {
        const index = indexes[line * w + column];
        const target = (row * w + column) * 4;
        if (index === control.transparent || index * 3 + 2 >= table.length) { picture.data[target + 3] = 0; continue; }
        picture.data[target] = table[index * 3]; picture.data[target + 1] = table[index * 3 + 1]; picture.data[target + 2] = table[index * 3 + 2]; picture.data[target + 3] = 255;
      }
    }
    const piece = createCanvas(w, h);
    piece.getContext('2d').putImageData(picture, 0, 0);
    const before = control.disposal === 3 ? wholeCtx.getImageData(0, 0, width, height) : null;
    wholeCtx.drawImage(piece, x, y);
    const snapshot = createCanvas(width, height);
    snapshot.getContext('2d').drawImage(whole, 0, 0);
    // A delay of 0 or 1 hundredth is shown as a tenth of a second by the browsers.
    const delay = control.delayMs <= 10 ? 100 : control.delayMs;
    frames.push({ canvas: snapshot, delayMs: Math.min(max.maxDelayMs, Math.max(max.minDelayMs, delay)) });
    if (control.disposal === 2) wholeCtx.clearRect(x, y, w, h);
    else if (control.disposal === 3 && before) wholeCtx.putImageData(before, 0, 0);
    control = { disposal: 0, delayMs: 100, transparent: -1 };
  }
  if (!frames.length) throw new Error('A GIF without pictures.');
  return frames.length < 2 ? null : { width, height, frames };
}

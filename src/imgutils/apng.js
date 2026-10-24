// i18n-ignore-file: these errors are only logged or swallowed (a card draws still), never shown to anyone
// Animated PNG (APNG), read and written by hand: a decoration of an avatar that moves comes as one, and a card that shows it
// moving is sent as one. A program that does not know APNG shows the first picture, so a card is never broken by it.
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const LIMITS = { frames: 150, side: 512, minDelayMs: 30, maxDelayMs: 2000 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** The chunks of a PNG as `{ type, data }`, in order. It throws on anything that is not a well-formed PNG. */
function readChunks(buffer) {
  if (buffer.length < 20 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG.');
  const chunks = [];
  let at = 8;
  while (at + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    if (length > buffer.length - at - 12) throw new Error('A PNG chunk is longer than the file.');
    const type = buffer.toString('latin1', at + 4, at + 8);
    chunks.push({ type, data: buffer.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  if (!chunks.length || chunks[0].type !== 'IHDR' || chunks[chunks.length - 1].type !== 'IEND') throw new Error('A PNG without a header or an end.');
  return chunks;
}

function frameControl(sequence, frame) {
  const data = Buffer.alloc(26);
  data.writeUInt32BE(sequence, 0);
  data.writeUInt32BE(frame.width, 4);
  data.writeUInt32BE(frame.height, 8);
  data.writeUInt32BE(frame.x, 12);
  data.writeUInt32BE(frame.y, 16);
  data.writeUInt16BE(Math.max(1, Math.min(65535, Math.round(frame.delayMs))), 20);
  data.writeUInt16BE(1000, 22);
  data[24] = 0; // dispose: leave the picture as it is
  data[25] = 0; // blend: replace what is under the frame
  return chunk('fcTL', data);
}

/**
 * Puts PNG pictures together as an APNG. The first one is the whole picture (and what a program without APNG shows); each next one
 * is `{ png, x, y, delayMs }` for a part of it, which replaces what is under it. All of them must be 8 bit RGBA like the first.
 */
function encodeApng(first, parts, { loops = 0 } = {}) {
  const base = readChunks(first.png);
  const header = base[0];
  const dataOf = (png) => Buffer.concat(readChunks(png).filter((c) => c.type === 'IDAT').map((c) => c.data));
  const out = [SIGNATURE, chunk('IHDR', header.data)];
  const control = Buffer.alloc(8);
  control.writeUInt32BE(parts.length + 1, 0);
  control.writeUInt32BE(loops, 4);
  out.push(chunk('acTL', control));
  let sequence = 0;
  out.push(frameControl(sequence++, { width: header.data.readUInt32BE(0), height: header.data.readUInt32BE(4), x: 0, y: 0, delayMs: first.delayMs }));
  out.push(chunk('IDAT', dataOf(first.png)));
  for (const part of parts) {
    const chunks = readChunks(part.png);
    const ihdr = chunks[0].data;
    if (!ihdr.subarray(8, 13).equals(header.data.subarray(8, 13))) throw new Error('The pictures of an animation must be of the same kind.');
    out.push(frameControl(sequence++, { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), x: part.x, y: part.y, delayMs: part.delayMs }));
    const seq = Buffer.alloc(4);
    seq.writeUInt32BE(sequence++, 0);
    out.push(chunk('fdAT', Buffer.concat([seq, dataOf(part.png)])));
  }
  out.push(chunk('IEND'));
  return Buffer.concat(out);
}

/**
 * The frames of an APNG as whole pictures, `[{ canvas, delayMs }]`, or null when the file is a still PNG. Frames that only
 * draw a part of the picture are put together here, following their blend and dispose rules.
 */
async function decodeApng(buffer, { maxFrames = LIMITS.frames, maxSide = LIMITS.side } = {}) {
  const chunks = readChunks(buffer);
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (!chunks.some((c) => c.type === 'acTL')) return null;
  if (!width || !height || width > maxSide || height > maxSide) throw new Error('That animation is too large.');
  const declared = chunks.find((c) => c.type === 'acTL').data.readUInt32BE(0);
  if (declared < 2 || declared > maxFrames) throw new Error('That animation has too many frames, or one.');

  const shared = chunks.filter((c) => (c.type === 'PLTE' || c.type === 'tRNS' || c.type === 'gAMA' || c.type === 'sRGB' || c.type === 'cHRM' || c.type === 'iCCP'));
  const frames = [];
  let current = null;
  for (const c of chunks) {
    if (c.type === 'fcTL') {
      if (c.data.length < 26) throw new Error('A broken frame header.');
      const den = c.data.readUInt16BE(22) || 100;
      current = {
        width: c.data.readUInt32BE(4), height: c.data.readUInt32BE(8), x: c.data.readUInt32BE(12), y: c.data.readUInt32BE(16),
        delayMs: (c.data.readUInt16BE(20) / den) * 1000, dispose: c.data[24], blend: c.data[25], data: [],
      };
      if (!current.width || !current.height || current.x + current.width > width || current.y + current.height > height) throw new Error('A frame outside the picture.');
      frames.push(current);
    } else if (c.type === 'IDAT' && current && frames.length === 1 && !current.sawFdat) current.data.push(c.data);
    else if (c.type === 'fdAT' && current) { current.sawFdat = true; current.data.push(c.data.subarray(4)); }
  }
  if (frames.length < 2 || frames.length > maxFrames) throw new Error('That animation has too many frames, or one.');

  const whole = createCanvas(width, height);
  const wholeCtx = whole.getContext('2d');
  const result = [];
  for (const frame of frames) {
    const data = Buffer.concat(frame.data);
    if (!data.length) throw new Error('A frame without data.');
    const frameHeader = Buffer.from(ihdr);
    frameHeader.writeUInt32BE(frame.width, 0);
    frameHeader.writeUInt32BE(frame.height, 4);
    const png = Buffer.concat([SIGNATURE, chunk('IHDR', frameHeader), ...shared.map((c) => chunk(c.type, c.data)), chunk('IDAT', data), chunk('IEND')]);
    const image = await loadImage(png);
    const before = frame.dispose === 2 ? wholeCtx.getImageData(0, 0, width, height) : null;
    if (frame.blend === 0) wholeCtx.clearRect(frame.x, frame.y, frame.width, frame.height);
    wholeCtx.drawImage(image, frame.x, frame.y);
    const snapshot = createCanvas(width, height);
    snapshot.getContext('2d').drawImage(whole, 0, 0);
    result.push({ canvas: snapshot, delayMs: Math.min(LIMITS.maxDelayMs, Math.max(LIMITS.minDelayMs, frame.delayMs)) });
    if (frame.dispose === 1) wholeCtx.clearRect(frame.x, frame.y, frame.width, frame.height);
    else if (frame.dispose === 2) wholeCtx.putImageData(before, 0, 0);
  }
  return result;
}

module.exports = { LIMITS, encodeApng, decodeApng, readChunks };

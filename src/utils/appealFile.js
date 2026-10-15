// The files a member attaches to the answers of an appeal form: pictures, PDFs and plain text. What is stored is checked by
// what the bytes are, not by the name or the type the browser said, and pictures are re-drawn so only pixels are kept.
const { prepareImage } = require('./appealImage');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 200 * 1024;
const MAX_LOOSE = 20; // files a person has uploaded and not sent yet
// What a file question can take, from the dashboard.
const ACCEPT = {
  images: ['image'],
  pdf: ['pdf'],
  images_pdf: ['image', 'pdf'],
  documents: ['image', 'pdf', 'text'],
};
const ACCEPT_KEYS = Object.keys(ACCEPT);
const MAX_FILES_LIMIT = 5;

/** What the bytes are: `image`, `pdf`, `text` or null. */
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  const head = buffer.subarray(0, 12);
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image';
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.length <= MAX_TEXT_BYTES) {
    // Text has no control bytes other than the tab and the line breaks, and is valid UTF-8.
    for (const byte of buffer) if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return null;
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return 'text'; } catch { return null; }
  }
  return null;
}

/** A file name that is safe to show and to put in a download header. */
function cleanName(name, fallback = 'file') {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (base || fallback).slice(0, 80);
}

/**
 * Checks an upload against what the question accepts and returns what is stored: `{ bytes, mime, name }`. Throws an error whose
 * message is `too_big`, `unsupported` or `unreadable`.
 */
async function prepareFile(buffer, { accept = 'images', name = 'file' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('unreadable');
  if (buffer.length > MAX_BYTES) throw new Error('too_big');
  const kind = sniff(buffer);
  if (!kind || !(ACCEPT[accept] ?? ACCEPT.images).includes(kind)) throw new Error('unsupported');
  const safeName = cleanName(name);
  if (kind === 'image') {
    let clean;
    try { clean = await prepareImage(buffer, 'proof'); } catch { throw new Error('unreadable'); }
    return { bytes: clean.bytes, mime: 'image/png', name: safeName.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.png', width: clean.width, height: clean.height };
  }
  if (kind === 'pdf') return { bytes: buffer, mime: 'application/pdf', name: /\.pdf$/i.test(safeName) ? safeName : `${safeName}.pdf` };
  return { bytes: buffer, mime: 'text/plain; charset=utf-8', name: /\.txt$/i.test(safeName) ? safeName : `${safeName}.txt` }; // i18n-ignore: a media type
}

module.exports = { MAX_BYTES, MAX_LOOSE, MAX_FILES_LIMIT, ACCEPT, ACCEPT_KEYS, sniff, cleanName, prepareFile };

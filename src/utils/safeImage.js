// Downloads an image for a card from a link a server owner typed. That link is not to be trusted: it must not reach
// the bot's own network, so every address the name resolves to is checked at connection time, redirects are
// followed by hand and checked again, and the download is limited in time and size.
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { loadImage } = require('@napi-rs/canvas');

const LIMITS = { bytes: 6 * 1024 * 1024, pixels: 25_000_000, timeoutMs: 8000, redirects: 3, cacheEntries: 40, cacheBytes: 24 * 1024 * 1024, cacheTtlMs: 10 * 60_000 };
const TYPES = /^image\/(png|jpeg|webp|gif)\b/i;

/** True for an address that is not on the public internet: loopback, private, link-local, shared, multicast, reserved. */
function isPrivateAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (kind === 6) {
    const text = address.toLowerCase();
    const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return text === '::' || text === '::1' || /^f[cd]/.test(text) || /^fe[89ab]/.test(text) || text.startsWith('ff') || text.startsWith('64:ff9b');
  }
  return true;
}

/** A DNS lookup that refuses any address that is not public, used for the connection itself. */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = addresses.filter((entry) => !isPrivateAddress(entry.address));
    if (!list.length) return callback(new Error('That address is not on the public internet.'));
    if (options && options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('That is not a valid link.'); }
  if (url.protocol !== 'https:') throw new Error('Only https links are allowed.');
  if (url.username || url.password) throw new Error('Links with a user or password are not allowed.');
  if (url.port && url.port !== '443') throw new Error('Only the standard https port is allowed.');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That address is not on the public internet.');
  return url;
}

function download(url, hops, request = https.request) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', lookup: safeLookup, timeout: LIMITS.timeoutMs, headers: { 'User-Agent': 'PettoCards/1.0', Accept: 'image/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hops >= LIMITS.redirects) return reject(new Error('Too many redirects.'));
        let next;
        try { next = checkUrl(new URL(res.headers.location, url).toString()); } catch (error) { return reject(error); }
        return resolve(download(next, hops + 1, request));
      }
      if (status !== 200) { res.resume(); return reject(new Error(`The image server answered ${status}.`)); }
      if (!TYPES.test(String(res.headers['content-type'] ?? ''))) { res.resume(); return reject(new Error('That link is not a PNG, JPEG, WebP or GIF image.')); }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > LIMITS.bytes) { res.resume(); return reject(new Error('That image is too large.')); }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > LIMITS.bytes) { req.destroy(new Error('That image is too large.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The image took too long to download.')));
    req.on('error', reject);
    req.end();
  });
}

const cache = new Map();
let cacheBytes = 0;
function remember(key, buffer) {
  if (buffer.length > LIMITS.cacheBytes / 4) return;
  cache.set(key, { buffer, at: Date.now() });
  cacheBytes += buffer.length;
  while (cache.size > LIMITS.cacheEntries || cacheBytes > LIMITS.cacheBytes) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).buffer.length;
    cache.delete(oldest);
  }
}

/** The bytes of an image link, from the cache when it was fetched recently. */
async function fetchImageBuffer(link, request) {
  const hit = cache.get(link);
  if (hit && Date.now() - hit.at < LIMITS.cacheTtlMs) return hit.buffer;
  const buffer = await download(checkUrl(link), 0, request);
  remember(link, buffer);
  return buffer;
}

/** Decodes bytes into an image, refusing one whose pixels would be too many to draw. */
async function decode(buffer) {
  const image = await loadImage(buffer);
  if (image.width * image.height > LIMITS.pixels) throw new Error('That image has too many pixels.');
  return image;
}

/** An image for a link, or null when it cannot be had. It never throws: a card without one image still draws. */
async function loadImageFromLink(link, request) {
  try { return await decode(await fetchImageBuffer(link, request)); } catch { return null; }
}

module.exports = { LIMITS, isPrivateAddress, checkUrl, safeLookup, fetchImageBuffer, loadImageFromLink, decode };

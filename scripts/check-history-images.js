// Checks the copies of the avatars of the profile history: a new avatar is downloaded and kept as a 256 px WebP, the queue runs two at a
// time and has a limit, a failure is tried once more, a picture Discord no longer has is marked, turning the history off drops and deletes
// the copies, the backfill marks the 404s and stops, the route follows the page's rules, and the avatar picture uses the copies.
// The database and Discord are replaced by stand-ins (scripts/check-history-images-db.js checks the SQL against PostgreSQL).
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const identity = require('../src/utils/identityHistory');
const { createAvatarCopies, sourceUrl } = require('../src/utils/avatarCopies');
const { backfillStep } = require('../src/jobs/profileHistoryBackfillJob');
const { registerHistoryImageRoutes } = require('../src/web/historyImageRoutes');
const { renderAvatarSheet } = require('../src/utils/avatarSheet');
const { decode } = require('../src/utils/safeImage');

const A = '111111111111111111';
const B = '222222222222222222';
const hash = (n) => n.toString(16).padStart(32, '0');
const tick = () => new Promise((resolve) => setImmediate(resolve));

const png = (() => {
  const canvas = createCanvas(512, 400);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e04040';
  ctx.fillRect(0, 0, 512, 400);
  return canvas.toBuffer('image/png');
})();

/** The history and the copies in memory, with the rules of the SQL: a copy only while its entry exists and the person did not opt out. */
function memoryDb() {
  const rows = [];
  const out = new Set();
  const images = new Map(); // `${user}:${hash}` -> { bytes, size, missing, attempts, content_type }
  const allowed = (userId, value) => rows.some((r) => r.user_id === userId && r.kind === 'avatar' && r.value === value) && !out.has(userId);
  const db = {
    rows, out, images,
    latest: async (userId, kind, guildId = null) => rows.filter((r) => r.user_id === userId && r.kind === kind && (r.guild_id ?? null) === guildId).at(-1)?.value ?? null,
    add: async (userId, kind, value, guildId = null) => { rows.push({ user_id: userId, kind, value, guild_id: guildId, seen_at: new Date(Date.now() + rows.length) }); },
    trim: async () => {},
    isOptedOut: async (userId) => out.has(userId),
    // As identityHistory.setOptOut (and the trigger of schema.sql): turning it off deletes the copies.
    setOptOut: async (userId, value) => { if (value) { out.add(userId); for (const key of [...images.keys()]) if (key.startsWith(`${userId}:`)) images.delete(key); } else out.delete(userId); },
    clear: async (userId, kind) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].user_id === userId && (!kind || rows[i].kind === kind)) rows.splice(i, 1);
      if (!kind || kind === 'avatar') for (const key of [...images.keys()]) if (key.startsWith(`${userId}:`)) images.delete(key);
      return before - rows.length;
    },
  };
  const imagesDb = {
    store: async (userId, value, { contentType, bytes }) => {
      if (!allowed(userId, value)) return false;
      images.set(`${userId}:${value}`, { bytes, size: bytes.length, missing: false, attempts: 0, content_type: contentType });
      return true;
    },
    markFailed: async (userId, value, { missing = false } = {}) => {
      if (!allowed(userId, value)) return;
      const old = images.get(`${userId}:${value}`);
      if (old?.bytes) return;
      images.set(`${userId}:${value}`, { bytes: null, size: 0, missing: Boolean(old?.missing || missing), attempts: (old?.attempts ?? 0) + 1, content_type: 'image/webp' });
    },
    totalSize: async () => [...images.values()].reduce((sum, image) => sum + image.size, 0),
    get: async (userId, value) => { const image = images.get(`${userId}:${value}`); return image?.size ? image : null; },
    status: async (userId, value) => images.get(`${userId}:${value}`) ?? null,
    recorded: async (userId, value) => rows.some((r) => r.user_id === userId && r.kind === 'avatar' && r.value === value),
    // Pieces of the history newest first along the id, as the SQL: `{ rows, cursor }`, cursor null when there is nothing older.
    backfillCandidates: async (beforeId = null, chunk = 50) => {
      const piece = rows.map((r, index) => ({ ...r, id: index + 1 })).filter((r) => r.kind === 'avatar' && (beforeId == null || r.id < beforeId)).reverse().slice(0, chunk);
      const cursor = piece.length ? piece.at(-1).id : null;
      return { cursor, rows: piece.filter((r) => {
        const image = images.get(`${r.user_id}:${r.value}`);
        return !out.has(r.user_id) && (!image || (!image.size && !image.missing && image.attempts < 3));
      }).map((r) => ({ user_id: r.user_id, hash: r.value })) };
    },
  };
  return { db, imagesDb };
}

/** Discord's CDN: `answers` maps a hash to a list of what each request gets (a status number, or 'ok'); `gate` holds requests open. */
function fakeCdn({ answers = {}, gate = null } = {}) {
  const asked = [];
  let active = 0;
  let most = 0;
  const fetchBuffer = async (link, _request, options) => {
    asked.push(link);
    assert.ok(options.maxBytes <= 2 * 1024 * 1024, 'the download is limited');
    active += 1;
    most = Math.max(most, active);
    try {
      if (gate) await gate();
      const value = /avatars\/\d+\/([0-9a-f_]+)\.png/.exec(link)[1];
      const list = answers[value];
      const answer = list?.length ? list.shift() : 'ok';
      if (answer !== 'ok') throw Object.assign(new Error(`The image server answered ${answer}.`), { status: answer });
      return png;
    } finally {
      active -= 1;
    }
  };
  return { fetchBuffer, asked, most: () => most };
}

// The queue's timers do not keep a process alive (the bot has other work); this one does, until the checks are done, and stops a hang.
const keepAlive = setTimeout(() => { console.error('The avatar copies check took too long.'); process.exit(1); }, 30_000);

(async () => {
  // 1. Recording a new avatar keeps its picture: 256x256 WebP, from the CDN link of that hash.
  {
    const { db, imagesDb } = memoryDb();
    const cdn = fakeCdn();
    db.copies = createAvatarCopies({ db: imagesDb, fetchBuffer: cdn.fetchBuffer, decode, gapMs: 0, retryDelayMs: 0 });
    const user = { id: A, bot: false, avatar: hash(1), globalName: 'Liam', username: 'ft8d' };
    assert.deepEqual(await identity.noteUser(user, db), ['avatar', 'name']);
    await db.copies.idle();
    const kept = db.images.get(`${A}:${hash(1)}`);
    assert.ok(kept?.bytes, 'the new avatar is kept');
    assert.equal(kept.bytes.subarray(8, 12).toString('latin1'), 'WEBP', 'as WebP');
    const image = await loadImage(kept.bytes);
    assert.deepEqual([image.width, image.height], [256, 256], 'drawn at 256 px');
    assert.equal(cdn.asked[0], sourceUrl(A, hash(1)));
    assert.ok(cdn.asked[0].startsWith(`https://cdn.discordapp.com/avatars/${A}/${hash(1)}.png`), 'a still picture, also for an animated avatar');
    assert.deepEqual(await identity.noteUser(user, db), [], 'the same avatar is not saved again');
    await db.copies.idle();
    assert.equal(cdn.asked.length, 1, 'nor downloaded again');
    assert.equal(db.copies.enqueue(A, 'not-a-hash'), 'invalid');
  }

  // 2. The queue: two downloads at a time, a duplicate is not queued twice, and a full queue refuses more.
  {
    const { db, imagesDb } = memoryDb();
    let release;
    let opened = new Promise((resolve) => { release = resolve; });
    const cdn = fakeCdn({ gate: () => opened });
    const copies = createAvatarCopies({ db: imagesDb, fetchBuffer: cdn.fetchBuffer, decode, gapMs: 0, retryDelayMs: 0, maxQueue: 3 });
    for (let n = 1; n <= 5; n += 1) await db.add(A, 'avatar', hash(n));
    const results = [1, 2, 3, 4, 5, 6].map((n) => copies.enqueue(A, hash(n)));
    assert.deepEqual(results, ['queued', 'queued', 'queued', 'queued', 'queued', 'full'], 'two run, three wait, the sixth is refused');
    assert.equal(copies.enqueue(A, hash(3)), 'duplicate');
    await tick();
    assert.equal(copies.stats().running, 2);
    release();
    await copies.idle();
    assert.equal(cdn.most(), 2, 'never more than two downloads at a time');
    assert.equal([...db.images.values()].filter((i) => i.size).length, 5, 'the five of the history are kept');
    assert.equal(db.images.has(`${A}:${hash(6)}`), false, 'the refused one is not');
    opened = Promise.resolve();
  }

  // 3. A failure is tried once more and then given up (counted); Discord's 404 is marked as gone at once, without a second try.
  {
    const { db, imagesDb } = memoryDb();
    const cdn = fakeCdn({ answers: { [hash(1)]: [500, 'ok'], [hash(2)]: [500, 502], [hash(3)]: [404] } });
    const copies = createAvatarCopies({ db: imagesDb, fetchBuffer: cdn.fetchBuffer, decode, gapMs: 0, retryDelayMs: 0 });
    for (let n = 1; n <= 3; n += 1) { await db.add(A, 'avatar', hash(n)); copies.enqueue(A, hash(n)); }
    await copies.idle();
    assert.ok(db.images.get(`${A}:${hash(1)}`).size, 'the second try worked');
    assert.deepEqual(db.images.get(`${A}:${hash(2)}`), { bytes: null, size: 0, missing: false, attempts: 1, content_type: 'image/webp' }, 'two failures: one failed attempt');
    assert.equal(db.images.get(`${A}:${hash(3)}`).missing, true, 'a 404 is marked');
    assert.equal(cdn.asked.filter((link) => link.includes(hash(3))).length, 1, 'and not retried');
    assert.equal(cdn.asked.length, 5);
  }

  // 4. Turning the history off drops what waits in the queue, does not save what was downloading, and deletes the kept copies.
  {
    const { db, imagesDb } = memoryDb();
    let release;
    const opened = new Promise((resolve) => { release = resolve; });
    let gated = false;
    const cdn = fakeCdn({ gate: () => (gated ? opened : null) });
    db.copies = createAvatarCopies({ db: imagesDb, fetchBuffer: cdn.fetchBuffer, decode, gapMs: 0, retryDelayMs: 0 });
    await identity.noteUser({ id: B, bot: false, avatar: hash(9), username: 'other' }, db);
    await db.copies.idle();
    assert.ok(db.images.get(`${B}:${hash(9)}`)?.size, 'kept before');
    gated = true;
    for (let n = 1; n <= 4; n += 1) { await db.add(B, 'avatar', hash(n)); db.copies.enqueue(B, hash(n)); }
    await tick();
    await identity.setRecording(B, false, db);
    assert.equal(db.copies.stats().queued, 0, 'the waiting ones are dropped');
    release();
    await db.copies.idle();
    assert.equal([...db.images.keys()].filter((key) => key.startsWith(`${B}:`)).length, 0, 'nothing of theirs is kept, old or new');
    assert.equal(cdn.asked.length, 3, 'only the two that were already downloading were asked for');
    identity.forgetOptOut(B);
    assert.deepEqual(await identity.noteUser({ id: B, bot: false, avatar: hash(7), username: 'other' }, db), [], 'and nothing new is recorded');
    await identity.setRecording(B, true, db);
    // Deleting the avatars (clear) takes the copies too.
    const { db: db2, imagesDb: images2 } = memoryDb();
    db2.copies = createAvatarCopies({ db: images2, fetchBuffer: fakeCdn().fetchBuffer, decode, gapMs: 0, retryDelayMs: 0 });
    await identity.noteUser({ id: A, bot: false, avatar: hash(5), username: 'me' }, db2);
    await db2.copies.idle();
    assert.equal(db2.images.size, 1);
    assert.equal(await identity.clearHistory(A, 'name', db2), 1);
    assert.equal(db2.images.size, 1, 'deleting the names keeps the avatars');
    assert.equal(await identity.clearHistory(A, 'avatar', db2), 1);
    assert.equal(db2.images.size, 0, 'deleting the avatars deletes their copies');
  }

  // 5. The backfill: the history without copies is read in pieces and tried through the same queue, the 404s are marked, and a second
  //    pass has nothing left to try.
  {
    const { db, imagesDb } = memoryDb();
    const cdn = fakeCdn({ answers: { [hash(1)]: [404], [hash(2)]: [404], [hash(4)]: [404] } });
    const copies = createAvatarCopies({ db: imagesDb, fetchBuffer: cdn.fetchBuffer, decode, gapMs: 0, retryDelayMs: 0 });
    for (let n = 1; n <= 6; n += 1) await db.add(A, 'avatar', hash(n));
    await db.add(B, 'avatar', hash(7));
    db.out.add(B);
    await db.add(A, 'name', 'not an avatar');
    const pass = async () => {
      let cursor = null;
      const added = [];
      for (;;) {
        const step = await backfillStep({ db: imagesDb, copies, cursor, chunk: 3 });
        assert.ok(step, 'the queue is idle between steps here');
        added.push(step.added);
        await copies.idle();
        if (step.done) return added;
        cursor = step.cursor;
      }
    };
    assert.deepEqual(await pass(), [2, 3, 1, 0], 'pieces of 3, newest first; someone who turned it off is skipped; the end is reached');
    assert.equal(cdn.asked[0], sourceUrl(A, hash(6)), 'the newest first');
    assert.equal(cdn.asked.length, 6, 'one request per avatar, none for someone who turned it off');
    assert.deepEqual([1, 2, 4].map((n) => db.images.get(`${A}:${hash(n)}`).missing), [true, true, true], 'the 404s are marked');
    assert.deepEqual([3, 5, 6].map((n) => Boolean(db.images.get(`${A}:${hash(n)}`).size)), [true, true, true], 'the ones Discord still serves are kept');
    assert.deepEqual(await pass(), [0, 0, 0, 0], 'a second pass tries nothing: the 404s are not asked again');
    assert.equal(cdn.asked.length, 6);
    // A step waits while the queue is busy, and nothing is added past the total limit.
    const full = createAvatarCopies({ db: { ...imagesDb, totalSize: async () => 5 }, fetchBuffer: cdn.fetchBuffer, decode, totalLimit: 5 });
    await db.add(A, 'avatar', hash(8));
    assert.equal(await backfillStep({ db: imagesDb, copies: full }), null, 'past the total limit nothing is added');
    let release;
    const busy = createAvatarCopies({ db: imagesDb, fetchBuffer: async () => { await new Promise((resolve) => { release = resolve; }); throw Object.assign(new Error('gone'), { status: 404 }); }, decode, gapMs: 0, concurrency: 1 });
    for (let n = 20; n < 27; n += 1) { await db.add(A, 'avatar', hash(n)); busy.enqueue(A, hash(n)); }
    assert.equal(await backfillStep({ db: imagesDb, copies: busy }), null, 'nor while the queue is busy');
    busy.forgetUser(A);
    release();
  }

  // 6. The route: the site's key, the page's rules (your own always, somebody else's unless they turned it off), long cache headers.
  {
    const { db, imagesDb } = memoryDb();
    await db.add(A, 'avatar', hash(1));
    await db.add(A, 'avatar', hash(2));
    await imagesDb.store(A, hash(1), { contentType: 'image/webp', bytes: Buffer.from('RIFFxxxxWEBP') });
    const queued = [];
    let handler;
    registerHistoryImageRoutes({ get: (route, _limiter, fn) => { assert.equal(route, '/api/dashboard/history/avatar/:userId/:hash'); handler = fn; } }, {
      isAuthorized: (req) => req.key === 'secret', images: imagesDb, history: db, copies: () => ({ enqueue: (...args) => queued.push(args) }),
    });
    const call = async ({ key = 'secret', user = A, value = hash(1), viewer = A } = {}) => {
      const res = { statusCode: 0, headers: {}, body: null, set(name, val) { this.headers[name] = val; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = body; } };
      await handler({ key, params: { userId: user, hash: value }, query: { viewer_id: viewer } }, res);
      return res;
    };
    assert.equal((await call({ key: 'nope' })).statusCode, 401);
    assert.equal((await call({ value: '../etc' })).statusCode, 400);
    const own = await call();
    assert.equal(own.statusCode, 200);
    assert.equal(own.headers['Content-Type'], 'image/webp');
    assert.match(own.headers['Cache-Control'], /private, max-age=31536000, immutable/);
    assert.equal((await call({ viewer: B })).statusCode, 200, 'anybody may see a history that is on');
    const missing = await call({ value: hash(2) });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(queued, [[A, hash(2)]], 'an avatar of the history never tried is added to the queue');
    await call({ value: hash(3) });
    assert.equal(queued.length, 1, 'one that is not in the history is not');
    db.out.add(A);
    assert.equal((await call({ viewer: B })).statusCode, 404, 'somebody who turned it off is hidden from others');
  }

  // 7. The picture of `!profilehistory avatars` draws the kept copy instead of asking Discord.
  {
    const asked = [];
    const rows = [{ value: hash(1), seen_at: new Date() }, { value: hash(2), seen_at: new Date() }];
    const stored = new Map([[hash(1), png]]);
    const sheet = await renderAvatarSheet(A, rows, { stored, loader: async (link) => { asked.push(link); return null; } });
    assert.equal(sheet.shown, 2);
    assert.equal(asked.length, 1, 'only the avatar without a copy is asked for');
    assert.ok(asked[0].includes(hash(2)));
  }

  clearTimeout(keepAlive);
  console.log('Checked the avatar copies of the history: recording, the queue, retries and 404s, turning it off, the backfill, the route and the picture.');
})().catch((err) => { console.error(err); process.exit(1); });

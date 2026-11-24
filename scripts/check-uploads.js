// Own pictures: the plan that allows them, the policy first, a block, what waits for review, and what the team does (approve, reject, take down, block, a minor).
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', 'db', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const S = { policy: {}, blocked: new Map(), up: {} };
const get = (u) => (S.up[u] ??= { approved: null, pending: null, reject: null, removed: null });
stub('userUploads', {
  policyVersionOf: async (u) => S.policy[u] ?? 0, acceptPolicy: async (u, v) => { S.policy[u] = v; },
  isBlocked: async (u) => S.blocked.has(u), block: async (u, reason, by) => { S.blocked.set(u, { reason, by }); }, unblock: async (u) => S.blocked.delete(u),
  getState: async (u) => ({ hasApproved: Boolean(get(u).approved), hasPending: Boolean(get(u).pending), pendingAt: null, approvedAt: null, lastRejectReason: get(u).reject, lastRejectAt: null, removedReason: get(u).removed }),
  setPending: async (u, bytes, screened) => { get(u).pending = bytes; get(u).reject = null; get(u).screened = screened; },
  approve: async (u) => { const r = get(u); if (!r.pending) return false; r.approved = r.pending; r.pending = null; return true; },
  reject: async (u, reason) => { const r = get(u); if (!r.pending) return false; r.pending = null; r.reject = reason; return true; },
  takedown: async (u, reason) => { const r = S.up[u]; if (!r) return false; r.approved = null; r.pending = null; r.removed = reason; return true; },
  approvedBytes: async (u) => get(u).approved, pendingBytes: async (u) => get(u).pending,
  listPending: async () => Object.entries(S.up).filter(([, r]) => r.pending).map(([userId, r]) => ({ userId, pendingAt: 'x', screened: Boolean(r.screened) })), listBlocked: async () => [...S.blocked.keys()].map((userId) => ({ userId, reason: '', createdAt: 'x' })),
});
const plan = {}; stub('userPlans', { getPlan: async (u) => plan[u] ?? null });
const { createCanvas } = require('@napi-rs/canvas');
const png = (w, h) => createCanvas(w, h).toBuffer('image/png');
// A GIF made by hand (every picture one flat colour; the compressed data only uses "clear" codes, so it needs no encoder).
const gif = (w, h, colours) => {
  const parts = [Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0])];
  const table = Buffer.alloc(768); colours.forEach((c, i) => { table[i * 3] = c[0]; table[i * 3 + 1] = c[1]; table[i * 3 + 2] = c[2]; });
  parts.push(table);
  colours.forEach((_, i) => {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]), Buffer.from([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8]));
    const codes = []; const total = w * h;
    for (let at = 0; at < total; at += 250) { codes.push(256); for (let k = 0; k < Math.min(250, total - at); k += 1) codes.push(i); }
    codes.push(257);
    let bits = 0, count = 0; const bytes = [];
    for (const code of codes) { bits |= code << count; count += 9; while (count >= 8) { bytes.push(bits & 255); bits >>= 8; count -= 8; } }
    if (count) bytes.push(bits & 255);
    for (let at = 0; at < bytes.length; at += 255) { const chunk = bytes.slice(at, at + 255); parts.push(Buffer.from([chunk.length, ...chunk])); }
    parts.push(Buffer.from([0]));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
};
const actions = require('../src/utils/uploadActions');
const OWNER = '111111111111111111', FREE = '222222222222222222', SILVER = '333333333333333333', GOLD = '444444444444444444';
plan[SILVER] = { plan: 'silver', active: true }; plan[GOLD] = { plan: 'gold', active: true };
(async () => {
  // The plan: free cannot, Silver and Gold can.
  assert.equal((await actions.state(FREE)).allowed, false);
  assert.equal((await actions.state(SILVER)).allowed, true);
  assert.equal((await actions.state(GOLD)).perk, 'animated');
  assert.equal((await actions.submit(FREE, png(1024, 320))).error, 'premium_required');
  // The policy comes first.
  assert.equal((await actions.state(SILVER)).policyAccepted, false);
  assert.equal((await actions.submit(SILVER, png(1024, 320))).error, 'policy_required');
  await actions.acceptPolicy(SILVER);
  assert.equal((await actions.state(SILVER)).policyAccepted, true);
  // The file: not a picture, too big, too small.
  assert.equal((await actions.submit(SILVER, Buffer.from('not a picture'))).error, 'bad_file');
  assert.equal((await actions.submit(SILVER, 'nope')).error, 'bad_file');
  assert.equal((await actions.submit(SILVER, Buffer.alloc(actions.MAX_UPLOAD_BYTES + 1))).error, 'too_big');
  assert.equal((await actions.submit(SILVER, png(100, 50))).error, 'file_too_small');
  // A good picture waits for review; nothing is drawn until it is approved.
  assert.deepEqual(await actions.submit(SILVER, png(1200, 400)), { ok: true });
  assert.equal(await actions.approvedImage(SILVER), null, 'not approved yet: nothing to draw');
  assert.equal((await actions.queue()).pending.length, 1);
  assert.ok(Buffer.isBuffer(await actions.pendingFile(SILVER)));
  assert.equal(await actions.pendingFile('abc'), null);
  // Review.
  assert.equal((await actions.review(OWNER, { person: 'x', action: 'approve' })).error, 'bad_person');
  assert.equal((await actions.review(OWNER, { person: SILVER, action: 'nope' })).error, 'bad_request');
  assert.deepEqual(await actions.review(OWNER, { person: SILVER, action: 'approve' }), { ok: true });
  assert.ok(Buffer.isBuffer(await actions.approvedImage(SILVER)), 'approved: it is drawn');
  assert.equal((await actions.review(OWNER, { person: SILVER, action: 'approve' })).error, 'nothing_pending');
  // A new picture waits while the approved one stays; a rejection keeps the approved one and says why.
  await actions.submit(SILVER, png(1200, 400));
  assert.ok(Buffer.isBuffer(await actions.approvedImage(SILVER)));
  assert.deepEqual(await actions.review(OWNER, { person: SILVER, action: 'reject', reason: 'quality' }), { ok: true, blocked: false });
  assert.equal((await actions.state(SILVER)).upload.lastRejectReason, 'quality');
  assert.ok(Buffer.isBuffer(await actions.approvedImage(SILVER)));
  // A copyright claim: takedown removes it, and the person can block too.
  assert.deepEqual(await actions.review(OWNER, { person: SILVER, action: 'takedown', reason: 'copyright' }), { ok: true, blocked: false });
  assert.equal(await actions.approvedImage(SILVER), null);
  assert.equal((await actions.state(SILVER)).upload.removedReason, 'copyright');
  // A minor: removed, blocked at once, and it cannot be sent again.
  await actions.acceptPolicy(GOLD); await actions.submit(GOLD, png(1200, 400));
  assert.deepEqual(await actions.review(OWNER, { person: GOLD, action: 'reject', reason: 'minor' }), { ok: true, blocked: true });
  assert.equal(await actions.approvedImage(GOLD), null); assert.equal((await actions.pendingFile(GOLD)), null);
  assert.equal((await actions.state(GOLD)).blocked, true);
  assert.equal((await actions.submit(GOLD, png(1200, 400))).error, 'blocked');
  assert.equal((await actions.queue()).blocked.length, 1);
  // Unblock.
  assert.deepEqual(await actions.review(OWNER, { person: GOLD, action: 'unblock' }), { ok: true });
  assert.equal((await actions.review(OWNER, { person: GOLD, action: 'unblock' })).error, 'not_blocked');
  assert.deepEqual(await actions.submit(GOLD, png(1200, 400)), { ok: true });
  // The detector: without a key nothing is checked; with one, a picture with a minor is never kept and blocks the person, a flagged one is not accepted, a clean one waits marked as checked,
  // and a service that fails never blocks anybody.
  const imageScreen = require('../src/utils/imageScreen');
  assert.deepEqual(imageScreen.readAnswer({ results: [{ categories: { sexual: true, 'violence/graphic': false, hate: false } }] }), { checked: true, minor: false, reasons: ['sexual'] });
  assert.deepEqual(imageScreen.readAnswer({ results: [{ categories: { 'sexual/minors': true, sexual: true } }] }), { checked: true, minor: true, reasons: ['sexual'] });
  assert.deepEqual(imageScreen.readAnswer({ results: [{ categories: { 'violence/graphic': true, 'hate/threatening': true } }] }), { checked: true, minor: false, reasons: ['violence', 'hate'] });
  assert.deepEqual(imageScreen.readAnswer({ nothing: 1 }), { checked: false }, 'an answer that makes no sense is no check');
  delete process.env.OPENAI_API_KEY;
  assert.deepEqual(await imageScreen.screen(Buffer.from('x')), { checked: false }, 'no key: not checked');
  process.env.OPENAI_API_KEY = 'test-key';
  const calls = [];
  const answer = (categories, ok = true) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok, json: async () => ({ results: [{ categories }] }) }; };
  const realFetch = global.fetch;
  try {
    const DET = '555555555555555555', DET2 = '666666666666666666', DET3 = '777777777777777777', DET4 = '888888888888888888';
    for (const id of [DET, DET2, DET3, DET4]) { plan[id] = { plan: 'silver', active: true }; await actions.acceptPolicy(id); }
    global.fetch = answer({ sexual: false });
    assert.deepEqual(await actions.submit(DET, png(1200, 400)), { ok: true });
    assert.equal(S.up[DET].screened, true, 'a clean picture waits marked as checked');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/moderations'); assert.equal(calls[0].body.model, 'omni-moderation-latest'); assert.match(calls[0].body.input[0].image_url.url, /^data:image\/webp;base64,/); assert.equal(calls[0].auth, 'Bearer test-key');
    global.fetch = answer({ sexual: true });
    let flagged = await actions.submit(DET2, png(1200, 400));
    assert.deepEqual([flagged.ok, flagged.error, flagged.reasons], [false, 'detector', ['sexual']]);
    assert.equal(S.up[DET2]?.pending ?? null, null, 'a flagged picture is not kept'); assert.equal(S.blocked.has(DET2), false, 'and it does not block by itself');
    global.fetch = answer({ 'sexual/minors': true });
    assert.equal((await actions.submit(DET3, png(1200, 400))).error, 'blocked');
    assert.deepEqual(S.blocked.get(DET3), { reason: 'minor', by: 'detector' }); assert.equal(S.up[DET3]?.pending ?? null, null, 'never kept');
    global.fetch = async () => { throw new Error('network'); };
    assert.deepEqual(await actions.submit(DET4, png(1200, 400)), { ok: true });
    assert.equal(S.up[DET4].screened, false, 'a failure of the service: it goes to the team as not checked');
    global.fetch = answer({}, false);
    assert.deepEqual(await imageScreen.screen(Buffer.from('x')), { checked: false }, 'an error answer is no check');
  } finally { global.fetch = realFetch; delete process.env.OPENAI_API_KEY; }
  // An animated own picture: a GIF moves with the Gold plan (kept as an APNG, its first picture is what the detector sees); with Silver it is only its first picture.
  const animatedPictures = require('../src/utils/animatedPicture');
  const moving = gif(800, 200, [[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  const AN1 = '999999999999999990', AN2 = '999999999999999991';
  plan[AN1] = { plan: 'gold', active: true }; plan[AN2] = { plan: 'silver', active: true };
  await actions.acceptPolicy(AN1); await actions.acceptPolicy(AN2);
  assert.deepEqual(await actions.submit(AN1, moving), { ok: true });
  assert.equal(animatedPictures.isAnimated(S.up[AN1].pending), true, 'a GIF of a Gold plan is kept as an animation');
  const kept = await animatedPictures.framesOf(S.up[AN1].pending);
  assert.equal(kept.length, 3); assert.equal(kept[0].canvas.width, 512); assert.equal(kept[0].canvas.height, 160);
  assert.deepEqual([...kept[1].canvas.getContext('2d').getImageData(10, 10, 1, 1).data], [0, 255, 0, 255], 'each frame keeps its colour');
  assert.deepEqual(await actions.submit(AN2, moving), { ok: true });
  assert.equal(animatedPictures.isAnimated(S.up[AN2].pending), false, 'with Silver it is only a still picture');
  assert.equal((await actions.submit(AN1, gif(300, 100, [[1, 2, 3], [4, 5, 6]]))).error, 'file_too_small');
  assert.equal((await actions.submit(AN1, Buffer.from('GIF89a-not-really-a-gif-at-all'))).error, 'bad_file');
  assert.equal(await actions.mayAnimate(AN1), true); assert.equal(await actions.mayAnimate(AN2), false);
  // The rank card rules know the own picture as a background.
  const rank = require('../src/utils/userRankCard');
  assert.equal(rank.normalize({ background: 'upload:own' }).background, 'upload:own');
  assert.deepEqual(rank.backgroundOf(rank.normalize({ background: 'upload:own' })), { kind: 'upload' });
  assert.equal(rank.normalize({ background: 'upload:other' }).background, 'default');
  console.log('uploads: ok');
})().catch((error) => { console.error(error); process.exit(1); });

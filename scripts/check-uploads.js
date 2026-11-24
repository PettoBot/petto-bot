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
  setPending: async (u, bytes) => { get(u).pending = bytes; get(u).reject = null; },
  approve: async (u) => { const r = get(u); if (!r.pending) return false; r.approved = r.pending; r.pending = null; return true; },
  reject: async (u, reason) => { const r = get(u); if (!r.pending) return false; r.pending = null; r.reject = reason; return true; },
  takedown: async (u, reason) => { const r = S.up[u]; if (!r) return false; r.approved = null; r.pending = null; r.removed = reason; return true; },
  approvedBytes: async (u) => get(u).approved, pendingBytes: async (u) => get(u).pending,
  listPending: async () => Object.entries(S.up).filter(([, r]) => r.pending).map(([userId]) => ({ userId, pendingAt: 'x' })), listBlocked: async () => [...S.blocked.keys()].map((userId) => ({ userId, reason: '', createdAt: 'x' })),
});
const plan = {}; stub('userPlans', { getPlan: async (u) => plan[u] ?? null });
const { createCanvas } = require('@napi-rs/canvas');
const png = (w, h) => createCanvas(w, h).toBuffer('image/png');
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
  // The rank card rules know the own picture as a background.
  const rank = require('../src/utils/userRankCard');
  assert.equal(rank.normalize({ background: 'upload:own' }).background, 'upload:own');
  assert.deepEqual(rank.backgroundOf(rank.normalize({ background: 'upload:own' })), { kind: 'upload' });
  assert.equal(rank.normalize({ background: 'upload:other' }).background, 'default');
  console.log('uploads: ok');
})().catch((error) => { console.error(error); process.exit(1); });

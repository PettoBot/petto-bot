// Own badges: how many a plan allows, the policy and the block first, the name and the picture, the detector, what waits for the team and what it does (approve, reject,
// take down, block). The database and the registry are stand-ins.
const assert = require('node:assert/strict');
const path = require('node:path');
const stubAt = (dir, file, exports) => { const full = require.resolve(path.join('..', 'src', dir, file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const S = { policy: {}, blocked: new Map(), pending: new Map(), approved: new Map(), invalidated: 0 };
const key = (u, s) => `${u}:${s}`;
stubAt('db', 'userUploads', {
  policyVersionOf: async (u) => S.policy[u] ?? 0, acceptPolicy: async (u, v) => { S.policy[u] = v; },
  isBlocked: async (u) => S.blocked.has(u), block: async (u, reason, by) => { S.blocked.set(u, { reason, by }); }, unblock: async (u) => S.blocked.delete(u),
});
stubAt('db', 'userOwnBadges', {
  ownId: (u, s) => `own-${u}-${s}`,
  setPending: async (u, slot, name, image, screened) => { S.pending.set(key(u, slot), { name, image, screened }); },
  pendingOf: async (u) => [...S.pending].filter(([k]) => k.startsWith(`${u}:`)).map(([k, v]) => ({ userId: u, slot: Number(k.split(':')[1]), name: v.name, screened: v.screened, submittedAt: 'x' })),
  listPending: async () => [...S.pending].map(([k, v]) => ({ userId: k.split(':')[0], slot: Number(k.split(':')[1]), name: v.name, screened: v.screened, submittedAt: 'x' })),
  pendingImage: async (u, s) => S.pending.get(key(u, s))?.image ?? null,
  take: async (u, s) => { const v = S.pending.get(key(u, s)); S.pending.delete(key(u, s)); return v ?? null; },
  removePending: async (u, s) => S.pending.delete(key(u, s)),
  approvedOf: async (u) => [...S.approved].filter(([k]) => k.startsWith(`${u}:`)).map(([k, v]) => ({ slot: Number(k.split(':')[1]), name: v.name, id: `own-${u}-${k.split(':')[1]}` })),
  approve: async (u, s, name, image) => { S.approved.set(key(u, s), { name, image }); },
  removeApproved: async (u, s) => S.approved.delete(key(u, s)),
});
const plan = {};
stubAt('db', 'userPlans', { getPlan: async (u) => plan[u] ?? null });
stubAt('utils', 'badgeRegistry', { invalidate: () => { S.invalidated += 1; } });
const { createCanvas } = require('@napi-rs/canvas');
const png = (w, h) => createCanvas(w, h).toBuffer('image/png');
const uploads = require('../src/utils/uploadActions');
const own = require('../src/utils/ownBadgeActions');
const OWNER = '111111111111111111', FREE = '222222222222222222', BRONZE = '333333333333333333', SILVER = '444444444444444444', GOLD = '555555555555555555';
plan[BRONZE] = { plan: 'bronze', active: true }; plan[SILVER] = { plan: 'silver', active: true }; plan[GOLD] = { plan: 'gold', active: true };
(async () => {
  delete process.env.OPENAI_API_KEY;
  // How many each plan allows.
  assert.equal(await own.slotsOf(FREE), 0); assert.equal(await own.slotsOf(BRONZE), 1); assert.equal(await own.slotsOf(SILVER), 2); assert.equal(await own.slotsOf(GOLD), 4);
  plan[FREE] = { plan: 'gold', active: false };
  assert.equal(await own.slotsOf(FREE), 0, 'a plan that ended gives none');
  // The order of the checks.
  assert.equal((await own.submit(FREE, { slot: 1, name: 'Star' }, png(300, 300))).error, 'premium_required');
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Star' }, png(300, 300))).error, 'policy_required');
  await uploads.acceptPolicy(BRONZE); await uploads.acceptPolicy(SILVER); await uploads.acceptPolicy(GOLD);
  assert.equal((await own.submit(BRONZE, { slot: 9, name: 'Star' }, png(300, 300))).error, 'bad_slot');
  assert.equal((await own.submit(BRONZE, { slot: 2, name: 'Star' }, png(300, 300))).error, 'slot_locked', 'Bronze has one slot');
  for (const name of ['', 'a', 'x'.repeat(25), '<b>hi</b>', 'https://x.io', '@everyone']) assert.equal((await own.submit(BRONZE, { slot: 1, name }, png(300, 300))).error, 'bad_name', `bad name: ${name}`);
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Star' }, Buffer.alloc(0))).error, 'bad_file');
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Star' }, Buffer.from('not a picture'))).error, 'bad_file');
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Star' }, png(40, 40))).error, 'file_too_small');
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Star' }, Buffer.alloc(600_000, 1))).error, 'too_big');
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Star' }, Buffer.from('GIF89a-moving-badge-no'))).error, 'bad_file', 'a GIF is not a badge');
  // A good one waits, as a square 256 x 256 PNG; nobody has it until it is approved.
  assert.deepEqual(await own.submit(BRONZE, { slot: 1, name: '  Star   Fox ' }, png(600, 300)), { ok: true });
  const waiting = S.pending.get(key(BRONZE, 1));
  assert.equal(waiting.name, 'Star Fox'); assert.equal(waiting.screened, false);
  const { loadImage } = require('@napi-rs/canvas'); const shown = await loadImage(waiting.image);
  assert.deepEqual([shown.width, shown.height], [256, 256]);
  let st = await own.state(BRONZE);
  assert.deepEqual(st.items, [{ slot: 1, locked: false, approved: null, pending: { name: 'Star Fox' } }]); assert.equal(st.slots, 1);
  assert.equal(S.approved.size, 0);
  // The team approves: the badge is the person's, off sale, and the registry forgets what it knew.
  const before = S.invalidated;
  assert.equal((await own.review('x', { person: BRONZE, slot: 1, action: 'approve' })).ok, true);
  assert.equal(S.invalidated, before + 1); assert.equal(S.pending.size, 0);
  st = await own.state(BRONZE);
  assert.deepEqual(st.items[0].approved, { id: `own-${BRONZE}-1`, name: 'Star Fox' }); assert.equal(st.items[0].pending, null);
  assert.equal((await own.review('x', { person: BRONZE, slot: 1, action: 'approve' })).error, 'nothing_pending');
  // A new one for the same slot waits while the approved one stays.
  assert.deepEqual(await own.submit(BRONZE, { slot: 1, name: 'Moon' }, png(300, 300)), { ok: true });
  st = await own.state(BRONZE); assert.equal(st.items[0].approved.name, 'Star Fox'); assert.equal(st.items[0].pending.name, 'Moon');
  assert.deepEqual(await own.review(OWNER, { person: BRONZE, slot: 1, action: 'reject', reason: 'quality' }), { ok: true, blocked: false });
  assert.equal(S.pending.size, 0); assert.equal(S.approved.get(key(BRONZE, 1)).name, 'Star Fox', 'rejecting keeps the approved one');
  // Silver has two, Gold four.
  assert.equal((await own.submit(SILVER, { slot: 2, name: 'Two' }, png(300, 300))).ok, true); assert.equal((await own.submit(SILVER, { slot: 3, name: 'Three' }, png(300, 300))).error, 'slot_locked');
  for (const slot of [1, 2, 3, 4]) assert.equal((await own.submit(GOLD, { slot, name: `Gold ${slot}` }, png(300, 300))).ok, true);
  assert.equal((await own.state(GOLD)).items.length, 4);
  // The plan ends: what they have stays, but it is locked and nothing new can be made.
  plan[BRONZE] = { plan: 'bronze', active: false };
  st = await own.state(BRONZE); assert.equal(st.slots, 0); assert.equal(st.items[0].locked, true);
  assert.equal((await own.submit(BRONZE, { slot: 1, name: 'Again' }, png(300, 300))).error, 'premium_required');
  plan[BRONZE] = { plan: 'bronze', active: true };
  // The person removes theirs (the waiting one and the approved one); the team takes one down, with a block if it says so.
  assert.equal((await own.remove(BRONZE, { slot: 1 })).ok, true); assert.equal(S.approved.has(key(BRONZE, 1)), false);
  assert.equal((await own.remove(BRONZE, { slot: 1 })).error, 'nothing_to_remove'); assert.equal((await own.remove(BRONZE, { slot: 0 })).error, 'bad_slot');
  S.approved.set(key(GOLD, 4), { name: 'Gold 4', image: png(10, 10) });
  assert.deepEqual(await own.review(OWNER, { person: GOLD, slot: 4, action: 'takedown', reason: 'hate', block: true }), { ok: true, blocked: true });
  assert.deepEqual(S.blocked.get(GOLD), { reason: 'hate', by: OWNER });
  assert.equal((await own.submit(GOLD, { slot: 1, name: 'Blocked' }, png(300, 300))).error, 'blocked');
  assert.equal((await own.review(OWNER, { person: 'nope', slot: 1, action: 'approve' })).error, 'bad_person');
  assert.equal((await own.review(OWNER, { person: SILVER, slot: 2, action: 'maybe' })).error, 'bad_request');
  // The queue and the file of a waiting badge.
  assert.ok((await own.queue()).pending.some((row) => row.userId === SILVER && row.slot === 2));
  assert.ok(Buffer.isBuffer(await own.pendingFile(SILVER, 2))); assert.equal(await own.pendingFile(SILVER, 'x'), null); assert.equal(await own.pendingFile('bad', 2), null);
  // The detector: a flagged badge is not accepted, a minor is never kept and blocks, a clean one is marked as checked.
  process.env.OPENAI_API_KEY = 'test-key';
  const realFetch = global.fetch;
  const answer = (categories) => async () => ({ ok: true, json: async () => ({ results: [{ categories }] }) });
  try {
    global.fetch = answer({ hate: true });
    const flagged = await own.submit(SILVER, { slot: 1, name: 'Bad' }, png(300, 300));
    assert.deepEqual([flagged.ok, flagged.error, flagged.reasons], [false, 'detector', ['hate']]); assert.equal(S.pending.has(key(SILVER, 1)), false);
    global.fetch = answer({ 'sexual/minors': true });
    assert.equal((await own.submit(SILVER, { slot: 1, name: 'Worse' }, png(300, 300))).error, 'blocked');
    assert.deepEqual(S.blocked.get(SILVER), { reason: 'minor', by: 'detector' }); assert.equal(S.pending.has(key(SILVER, 1)), false);
    await (require('../src/db/userUploads').unblock(SILVER));
    global.fetch = answer({ sexual: false });
    assert.equal((await own.submit(SILVER, { slot: 1, name: 'Fine' }, png(300, 300))).ok, true); assert.equal(S.pending.get(key(SILVER, 1)).screened, true);
  } finally { global.fetch = realFetch; delete process.env.OPENAI_API_KEY; }
  console.log('own badges: ok');
})().catch((error) => { console.error(error); process.exit(1); });

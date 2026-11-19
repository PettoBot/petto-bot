// Checks the Premium watch: what counts as a change, that a grant (manual or paid), an extension, a revoke and an end are noticed, that the person gets or loses the Premium role at once,
// that every change has its record with the Premium gem, and that a failure of the role or of the record never stops the other. The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const warnings = [];
stub('src/utils/logger.js', { info() {}, warn: (m) => warnings.push(m), error() {} });
stub('src/db/postgres.js', { getPrimaryPool: () => ({ query: async () => ({ rows: [] }) }) });
const settings = { premiumLogChannelId: '123456789012345678' };
stub('src/config.js', settings);
stub('src/utils/emojis.js', { EMOJI: { GEM: '<:pe_gem:1566295308261007450>' } });
const { targetOf, classify, applyBatch, newState, isActiveNow, signature, recordText, recordCard, watchOnce, sendRecord, seed, WATCH_MS } = require('../src/utils/premiumWatch');

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-19T12:00:00Z');
const row = (over = {}) => ({ id: 1, user_id: '293504726505357312', provider: 'manual', plan_key: 'premium-manual-3', status: 'active', slot_limit: 3, current_period_end: null, metadata: { granted_by: '257181659865153539' }, updated_at: '2026-11-19T11:59:00.000Z', ...over });

(async () => {
  assert.equal(WATCH_MS, 15_000, 'it looks every 15 seconds');
  // What is active.
  assert.equal(isActiveNow(row(), NOW), true); assert.equal(isActiveNow(row({ status: 'expired' }), NOW), false);
  assert.equal(isActiveNow(row({ current_period_end: new Date(NOW - 1).toISOString() }), NOW), false, 'an end date that passed');
  assert.equal(isActiveNow(row({ current_period_end: new Date(NOW + DAY).toISOString() }), NOW), true);

  // What counts as a change.
  assert.equal(classify(undefined, row(), NOW), 'granted', 'a new active entitlement is a grant');
  assert.equal(classify(undefined, row({ status: 'expired' }), NOW), null, 'a new one that is already over says nothing');
  assert.equal(classify(row(), row(), NOW), null, 'the same row again says nothing');
  assert.equal(classify(row(), row({ slot_limit: 5, plan_key: 'premium-manual-5' }), NOW), 'changed', 'more slots');
  assert.equal(classify(row(), row({ current_period_end: new Date(NOW + 30 * DAY).toISOString() }), NOW), 'changed', 'an end date');
  assert.equal(classify(row(), row({ status: 'expired' }), NOW), 'revoked', 'a manual one that is over was revoked');
  assert.equal(classify(row({ provider: 'polar' }), row({ provider: 'polar', status: 'canceled' }), NOW), 'ended', 'a paid one that is over ended');
  assert.equal(classify(row({ status: 'expired' }), row(), NOW), 'granted', 'one that was over and is active again is a grant');
  assert.equal(classify(row({ updated_at: 'a' }), row({ updated_at: 'b', metadata: { other: 1 } }), NOW), null, 'what the record does not show does not count');
  assert.notEqual(signature(row()), signature(row({ slot_limit: 4 })));

  // A batch.
  const state = newState();
  let changes = applyBatch(state, [row()], NOW);
  assert.deepEqual(changes.map((c) => c.kind), ['granted']); assert.equal(state.cursor, '2026-11-19T11:59:00.000Z');
  changes = applyBatch(state, [row()], NOW); assert.equal(changes.length, 0, 'read again, nothing');
  const finite = row({ id: 2, provider: 'polar', current_period_end: new Date(NOW + 1000).toISOString(), updated_at: '2026-11-19T11:59:30.000Z' });
  applyBatch(state, [finite], NOW);
  changes = applyBatch(state, [], NOW + 5000);
  assert.deepEqual(changes.map((c) => [c.kind, c.entitlement.id]), [['expired', 2]], 'an end date that passes with no change in the database is noticed once');
  assert.equal(applyBatch(state, [], NOW + 9000).length, 0, 'and only once');

  // The record.
  const gem = '<:pe_gem:1566295308261007450>';
  const text = recordText({ kind: 'granted', entitlement: row() }, gem, true);
  assert.ok(text.startsWith(`### ${gem} Premium granted`), 'the title has the gem');
  assert.ok(text.includes('<@293504726505357312>') && text.includes('**Slots:** 3') && text.includes('no end date') && text.includes('Manual · by <@257181659865153539>') && text.includes('**Role:** given'));
  assert.ok(recordText({ kind: 'revoked', entitlement: row({ status: 'expired' }) }, gem, true).includes('**Role:** taken away'));
  assert.ok(recordText({ kind: 'granted', entitlement: row() }, gem, false).includes('not in the Premium server'));
  assert.ok(!recordText({ kind: 'granted', entitlement: row() }, gem, null).includes('**Role:**'), 'no line when the role was not looked at');
  assert.ok(recordText({ kind: 'granted', entitlement: row({ provider: 'polar', metadata: null, current_period_end: new Date(NOW + DAY).toISOString() }) }, gem, true).includes('**Source:** Polar'));
  assert.ok(recordText({ kind: 'granted', entitlement: row({ metadata: { target_type: 'server', target_guild_id: '1414452131850879080' } }) }, gem, true).includes('Server `1414452131850879080`'), 'a server grant names the server');
  const card = recordCard({ kind: 'granted', entitlement: row() }, gem, true, 'https://cdn.discordapp.com/avatars/1/a.png').toJSON();
  assert.equal(card.accent_color, 0xa5ea7a); assert.equal(card.components[0].accessory.type, 11, 'the avatar is at the side');
  assert.equal(recordCard({ kind: 'revoked', entitlement: row() }, gem, true, null).toJSON().components[0].type, 10, 'without an avatar it is plain text');

  // A look: the first one only remembers; the next ones give the role and write the record.
  let rows = [row()]; const asked = [];
  const query = async (sql, params) => { asked.push([sql, params]); return { rows }; };
  const synced = []; const sent = [];
  const deps = { client: {}, query, now: () => NOW, syncRole: async (client, userId) => { synced.push(userId); return true; }, send: async (client, change, roleSynced) => { sent.push([change.kind, roleSynced]); } };
  const watch = newState();
  assert.deepEqual(await watchOnce(watch, deps), [], 'the first look changes nothing'); assert.equal(watch.known.size, 1);
  rows = [row(), row({ id: 7, user_id: '257181659865153539', slot_limit: 1, plan_key: 'premium-manual-1', updated_at: '2026-11-19T12:00:10.000Z' })];
  changes = await watchOnce(watch, deps);
  assert.deepEqual(changes.map((c) => c.kind), ['granted']); assert.deepEqual(synced, ['257181659865153539'], 'the role is given at once, only to who changed');
  assert.deepEqual(sent, [['granted', true]]);
  assert.match(asked.at(-1)[0], /updated_at >= \$1/); assert.equal(asked.at(-1)[1][0], '2026-11-19T11:59:00.000Z', 'it asks from the last change it saw');
  rows = [row({ id: 7, user_id: '257181659865153539', slot_limit: 1, plan_key: 'premium-manual-1', status: 'expired', updated_at: '2026-11-19T12:00:40.000Z' })];
  synced.length = 0; sent.length = 0;
  changes = await watchOnce(watch, deps);
  assert.deepEqual([changes.map((c) => c.kind), synced, sent], [['revoked'], ['257181659865153539'], [['revoked', true]]], 'a revoke takes the role away at once and is recorded');
  assert.equal(asked.at(-1)[1][0], '2026-11-19T12:00:10.000Z', 'and the next look asks from the new last change');
  // A failing role or record does not stop the other, or the look.
  rows = [row({ id: 8, user_id: '111111111111111111', updated_at: '2026-11-19T12:01:00.000Z' })];
  sent.length = 0; warnings.length = 0;
  await watchOnce(watch, { ...deps, syncRole: async () => { throw new Error('Missing Permissions'); } });
  assert.deepEqual(sent, [['granted', null]], 'the record is written even when the role failed'); assert.ok(warnings.some((m) => /Missing Permissions/.test(m)));
  rows = [row({ id: 9, user_id: '222222222222222222', updated_at: '2026-11-19T12:02:00.000Z' })];
  synced.length = 0; warnings.length = 0;
  await watchOnce(watch, { ...deps, send: async () => { throw new Error('channel gone'); } });
  assert.deepEqual(synced, ['222222222222222222'], 'the role is given even when the record failed'); assert.ok(warnings.some((m) => /channel gone/.test(m)));

  // The record in the channel: the gem, the avatar and no mentions.
  const posted = [];
  const client = { channels: { fetch: async () => ({ send: async (payload) => { posted.push(payload); } }) }, users: { fetch: async () => ({ displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' }) } };
  await sendRecord(client, { kind: 'granted', entitlement: row() }, true);
  assert.equal(posted.length, 1); assert.deepEqual(posted[0].allowedMentions, { parse: [] }); assert.ok(JSON.stringify(posted[0].components[0].toJSON()).includes('pe_gem'));
  settings.premiumLogChannelId = null; posted.length = 0;
  await sendRecord(client, { kind: 'granted', entitlement: row() }, true);
  assert.equal(posted.length, 0, 'without a channel nothing is written (the role is still given)');
  settings.premiumLogChannelId = '123456789012345678';
  // The seed.
  const seeded = newState();
  await seed(seeded, async () => ({ rows: [row(), row({ id: 3, updated_at: '2026-11-19T10:00:00.000Z' })] }));
  assert.equal(seeded.known.size, 2); assert.equal(seeded.cursor, '2026-11-19T11:59:00.000Z');
  // Who a Premium is for: the key says it (the dashboard saved the owner of Petto as the holder of every grant, and the bot showed the grants as the owner's).
  const OWNER = '293504726505357312'; const PERSON = '111111111111111111'; const SERVER = '1414452131850879080';
  const fromDashboard = row({ id: 11, user_id: OWNER, provider_subscription_id: `manual:user:${PERSON}`, updated_at: '2026-11-19T12:05:00.000Z' });
  const forServer = row({ id: 12, user_id: OWNER, provider_subscription_id: `manual:server:${SERVER}`, metadata: { target_type: 'server', target_guild_id: SERVER }, slot_limit: 1, updated_at: '2026-11-19T12:06:00.000Z' });
  assert.deepEqual(targetOf(fromDashboard), { type: 'user', id: PERSON }, 'a grant for a person is for that person, not for the owner who saved it');
  assert.deepEqual(targetOf(forServer), { type: 'server', id: SERVER });
  assert.deepEqual(targetOf(row({ provider: 'polar', provider_subscription_id: 'sub_1' })), { type: 'user', id: '293504726505357312' }, 'a paid one is for its holder');
  assert.deepEqual(targetOf(row({ user_id: null, metadata: null })), { type: 'unknown', id: null });
  assert.ok(recordText({ kind: 'granted', entitlement: fromDashboard }, gem, true).includes(`<@${PERSON}> · \`${PERSON}\``) && !recordText({ kind: 'granted', entitlement: fromDashboard }, gem, true).includes(`<@${OWNER}> ·`), 'the record names the person');
  const dash = newState(); const syncedFor = []; const record = [];
  const dashDeps = { client: {}, now: () => NOW, syncRole: async (c, userId) => { syncedFor.push(userId); return true; }, send: async (c, change, roleSynced) => { record.push([change.entitlement.id, roleSynced]); } };
  let dashRows = [row()];
  dashDeps.query = async () => ({ rows: dashRows });
  await watchOnce(dash, dashDeps);
  dashRows = [fromDashboard, forServer];
  await watchOnce(dash, dashDeps);
  assert.deepEqual(syncedFor, [PERSON], 'the role goes to the person, not to the owner, and a Premium for a server gives no role');
  assert.deepEqual(record, [[11, true], [12, null]], 'both are recorded');
  // The grants saved before with the owner as holder are repaired by the schema when the bot starts.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src/db/schema.sql'), 'utf8');
  assert.ok(/update premium_entitlements\s+set user_id = substring\(provider_subscription_id from '\^manual:user:\(\[0-9\]\+\)\$'\)/.test(schema) && /update premium_slot_assignments a\s+set user_id = e\.user_id/.test(schema), 'schema.sql repairs the grants and their slots');
  // It is started with the bot and can be paused when the bot is degraded.
  assert.ok(/startPremiumWatchJob\(client\);/.test(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')), 'the job is started in index.js');
  assert.ok(/'premiumWatchJob'/.test(fs.readFileSync(path.join(__dirname, '..', 'src/utils/loadGuard.js'), 'utf8')), 'and listed in the load guard');
  console.log('Checked the Premium watch: what changed, the role at once, the record with the gem and the failures.');
})().catch((error) => { console.error(error); process.exit(1); });

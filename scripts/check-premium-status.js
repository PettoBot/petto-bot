// Checks what `!premium` shows: a person with more than one active Premium (a plan and a grant by hand, or two grants) sees the servers and the slots of all of them,
// not only those of the newest, and a new server goes to the Premium that still has a free slot. The database is replaced by a fake.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

const tables = { premium_entitlements: [], premium_slot_assignments: [], premium_slot_requests: [] };
const upserts = [];
const query = (table) => {
  const q = {
    select: () => q, eq: (column, value) => { q.filters.push([column, value]); return q; }, order: () => q, limit: () => q, update: () => q, upsert: (row) => { upserts.push(row); q.single = async () => ({ data: { id: 'new', ...row }, error: null }); return q; },
    filters: [],
    then: (resolve, reject) => Promise.resolve({ data: tables[table].filter((row) => q.filters.every(([column, value]) => row[column] === undefined || String(row[column]) === String(value))), error: null }).then(resolve, reject),
  };
  return q;
};
const databasePath = require.resolve(path.join(__dirname, '..', 'src/db/database.js'));
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { from: (table) => query(table), pool: {} } };
const premium = require('../src/db/premium');

(async () => {
  const USER = '111111111111111111';
  const future = new Date(Date.now() + 86_400_000).toISOString();
  // Two active Premiums: the newest has one server, the older (a grant by hand) has two.
  tables.premium_entitlements = [
    { id: 'e2', user_id: USER, provider: 'polar', plan_key: 'premium-1', status: 'active', slot_limit: 1, current_period_end: future },
    { id: 'e1', user_id: USER, provider: 'manual', plan_key: 'premium-manual-3', status: 'active', slot_limit: 3, current_period_end: null },
    { id: 'e0', user_id: USER, provider: 'polar', plan_key: 'premium-old', status: 'canceled', slot_limit: 5, current_period_end: null },
  ];
  tables.premium_slot_assignments = [
    { id: 'a1', user_id: USER, guild_id: '201', entitlement_id: 'e2', status: 'active' },
    { id: 'a2', user_id: USER, guild_id: '202', entitlement_id: 'e1', status: 'active' },
    { id: 'a3', user_id: USER, guild_id: '203', entitlement_id: 'e1', status: 'active' },
    { id: 'a4', user_id: USER, guild_id: '204', entitlement_id: 'e0', status: 'active' },
    { id: 'a5', user_id: USER, guild_id: '205', entitlement_id: 'e1', status: 'released' },
  ];
  const status = await premium.getUserPremium(USER);
  assert.equal(status.active, true);
  assert.deepEqual(status.assignments.map((each) => each.guild_id).sort(), ['201', '202', '203'], 'the servers of every active Premium, not of a canceled one or a released slot');
  assert.equal(status.slotsUsed, 3);
  assert.equal(status.slotsTotal, 4, 'the slots of all the active Premiums together (1 + 3)');
  assert.deepEqual(status.activeEntitlements.map((each) => each.id), ['e2', 'e1']);
  assert.equal(status.entitlement.id, 'e2', 'the first one is still the main one');

  // The card (Components V2) names the plans and every server.
  const { buildStatusCardForCheck } = require('../src/commands/info/premium');
  assert.equal(typeof buildStatusCardForCheck, 'function');
  const textsOf = (node) => (node?.components ?? []).flatMap((child) => [...(child.content ? [child.content] : []), ...textsOf(child), ...(child.accessory ? textsOf({ components: [child.accessory] }) : [])]);
  const person = { id: USER, username: 'liam', displayAvatarURL: () => 'https://x/a.png' };
  const interaction = { client: { guilds: { cache: new Map([['201', { name: 'One' }], ['202', { name: 'Two' }], ['203', { name: 'Three' }]]) } } };
  const card = buildStatusCardForCheck(interaction, person, status, 'en').toJSON();
  assert.equal(card.type, 17, 'a Components V2 container, not an embed');
  const all = textsOf(card).join('\n');
  assert.ok(/One/.test(all) && /Two/.test(all) && /Three/.test(all), 'the card lists the three servers');
  assert.match(all, /premium-1[\s\S]*premium-manual-3/, 'and both plans');
  assert.match(all, /`3 \/ 4`/, 'and the slots of all of them');
  assert.ok(card.components.some((row) => row.type === 1 && row.components.every((button) => button.style === 5)), 'with two link buttons');
  assert.match(all, /\/premium add/, 'and says how to give a slot');

  // Too many servers for a field: the last line says how many more.
  const lots = Array.from({ length: 60 }, (_, index) => ({ guild_id: String(1000000000000000000n + BigInt(index)) }));
  const big = buildStatusCardForCheck({ client: { guilds: { cache: new Map() } } }, person, { ...status, assignments: lots }, 'en').toJSON();
  const bigText = textsOf(big).find((each) => /Assigned servers/.test(each));
  assert.ok(bigText.length <= 1100, 'the list is cut');
  assert.match(bigText, /\n\+\d+$/, 'the last line counts the ones left out');

  // A new server goes to the Premium that has a free slot, even when the newest is full.
  upserts.length = 0;
  tables.premium_slot_assignments = tables.premium_slot_assignments.filter((each) => each.id !== 'a3'); // e1 has room (1 of 3), e2 is full (1 of 1)
  const assigned = await premium.assignPremiumSlot(USER, '300000000000000000');
  assert.equal(assigned.ok, true, `${JSON.stringify(assigned)} a person whose newest Premium is full is not told there are no slots while another has room`);
  assert.equal(upserts.at(-1).entitlement_id, 'e1', 'the slot is taken from the one with room');
  console.log('check-premium-status: ok');
  setTimeout(() => process.exit(0), 10);
})().catch((error) => { console.error(error); process.exit(1); });

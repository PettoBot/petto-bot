// The anti-nuke: each protection on its own, the whitelists, what it does to the account and what it keeps to restore.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

const { RULES, RULE_IDS, resolveRule } = require('../src/utils/antiNukeRules');

// ---- what a protection does with and without a saved row
const legacyOn = { enabled: true, action_threshold: 5, window_seconds: 10, whitelist_ids: ['9'], whitelist_role_ids: ['r1'] };
assert.equal(resolveRule(null, [], 'ban').enabled, false, 'nothing is on by itself');
assert.equal(resolveRule(legacyOn, [], 'ban').enabled, true, 'the old switch still covers the old protections');
assert.equal(resolveRule(legacyOn, [], 'ban').counterKey, 'legacy', 'and they are still counted together');
assert.equal(resolveRule(legacyOn, [], 'bot_add').enabled, false, 'a new protection does not start by surprise');
assert.equal(resolveRule(legacyOn, [], 'role_assign').enabled, false);
const row = { rule: 'ban', enabled: true, threshold: 2, window_seconds: 30, action: 'ban', alert_channel_id: 'c1', whitelist_ids: ['7'], whitelist_role_ids: [] };
const tuned = resolveRule(legacyOn, [row], 'ban');
assert.deepEqual([tuned.threshold, tuned.windowSeconds, tuned.action, tuned.alertChannelId, tuned.counterKey], [2, 30, 'ban', 'c1', 'ban']);
assert.deepEqual(tuned.whitelistIds.sort(), ['7', '9'], 'the shared whitelist and the own one are added');
assert.equal(resolveRule(legacyOn, [{ ...row, enabled: false }], 'ban').enabled, false, 'a saved row off wins over the old switch');
assert.equal(resolveRule(null, [], 'nope'), null);
for (const id of RULE_IDS) assert.ok(RULES[id].label && RULES[id].threshold >= 1 && RULES[id].window >= 2);

// ---- the engine, with the database and the logs replaced
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let config = { enabled: false, whitelist_ids: [], whitelist_role_ids: [] };
let rules = [];
const events = [];
const logs = [];
stub('../src/db/antinuke', { getConfig: async () => config, getRules: async () => rules, createEvent: async (e) => { const saved = { id: events.length + 1, ...e }; events.push(saved); return saved; } });
stub('../src/logging/engine', { sendLog: async (_c, _g, _e, embed, extra) => { logs.push({ embed, extra }); } });
const { track: trackAction } = require('../src/utils/antiNuke');
const { Collection } = require('discord.js');
let entryId = 0;
let lastTarget = 't';
const track = (c, g, options) => { lastTarget = options.targetId ?? 't'; return trackAction(c, g, options); };

const calls = [];
const member = (id, roleIds = [], extra = {}) => ({ id, manageable: true, kickable: true, roles: { cache: new Collection(roleIds.map((r) => [r, { id: r, managed: false }])), set: async (r) => calls.push(['roles.set', id, r]), remove: async (r) => calls.push(['roles.remove', id, r]) }, kick: async () => calls.push(['kick', id]), ...extra });
function makeGuild(execs) {
  const members = new Map(Object.entries(execs));
  return {
    id: 'g1', ownerId: 'owner', members: {
      cache: members, fetch: async (id) => members.get(id) ?? null,
      ban: async (id) => calls.push(['ban', id]), kick: async (id) => calls.push(['kick', id]),
    },
    channels: { fetch: async () => null },
    // Like discord.js: a Collection, and every action has its own entry (one entry is never blamed twice).
    fetchAuditLogs: async () => { entryId += 1; return { entries: new Collection([[`e${entryId}`, { id: `e${entryId}`, executor: current, targetId: lastTarget, createdTimestamp: Date.now() }]]) }; },
  };
}
let current;
const client = { user: { id: 'petto' } };
const human = { id: 'u1', bot: false, username: 'mallory' };
const bot = { id: 'b1', bot: true, username: 'evilbot' };

(async () => {
  const guild = makeGuild({ u1: member('u1', ['rA', 'rB']), b1: member('b1'), u2: member('u2', ['trusted']), u3: member('u3') });
  const hit = (extra = {}) => track(client, guild, { rule: 'channel_delete', auditLogType: 12, targetId: 't', actionLabel: 'channel deletion', undo: { kind: 'channel', name: 'general' }, ...extra });

  // off: nothing happens
  current = human;
  await hit(); await hit(); await hit();
  assert.equal(calls.length, 0, 'a protection that is off does nothing');

  // on with 3 in 10s, quarantine, one account trusted by role
  rules = [{ rule: 'channel_delete', enabled: true, threshold: 3, window_seconds: 10, action: 'quarantine', alert_channel_id: null, whitelist_ids: [], whitelist_role_ids: ['trusted'] }];
  await hit(); await hit();
  assert.equal(calls.length, 0, 'under the limit nothing happens');
  await hit();
  assert.deepEqual(calls.map((c) => c[0]), ['roles.set'], 'at the limit the account is quarantined');
  assert.deepEqual(calls[0].slice(1), ['u1', []]);
  assert.equal(events.length, 1);
  assert.equal(events[0].rule, 'channel_delete');
  assert.deepEqual(events[0].previous_roles, ['rA', 'rB'], 'the roles taken are kept to give them back');
  assert.equal(events[0].restorable.length, 3, 'and what was deleted is kept to rebuild it');
  assert.ok(logs.length === 1 && logs[0].extra.components?.length === 1, 'the alert has the restore button');
  await hit();
  assert.equal(events.length, 1, 'it answers once per window, not once per event');

  // a trusted role is never touched
  calls.length = 0; events.length = 0; current = { id: 'u2', bot: false, username: 'trusted-one' };
  await hit(); await hit(); await hit();
  assert.equal(calls.length, 0, 'a trusted role is never punished');
  // the owner and Petto too
  current = { id: 'owner', bot: false, username: 'owner' };
  await hit(); await hit(); await hit();
  current = { id: 'petto', bot: true, username: 'petto' };
  await hit(); await hit(); await hit();
  assert.equal(calls.length, 0, 'the owner and Petto are never punished');

  // a bot is banned even when the action is quarantine
  current = bot;
  rules = [{ ...rules[0], threshold: 1 }];
  await hit();
  assert.deepEqual(calls[0], ['ban', 'b1']);

  // alert only: nobody is punished and nothing needs restoring
  calls.length = 0; events.length = 0; logs.length = 0; current = { id: 'u3', bot: false, username: 'third' };
  rules = [{ ...rules[0], threshold: 1, action: 'alert' }];
  await track(client, guild, { rule: 'channel_delete', auditLogType: 12, targetId: 't2', actionLabel: 'channel deletion' });
  assert.equal(calls.length, 0, 'alert only punishes nobody');
  assert.equal(events.length, 1);
  assert.equal(logs[0].extra.components, undefined, 'no restore button when there is nothing to put back');

  // a bot added: the bot is removed on the spot
  calls.length = 0; events.length = 0; current = human;
  rules = [{ rule: 'bot_add', enabled: true, threshold: 1, window_seconds: 60, action: 'kick', alert_channel_id: null, whitelist_ids: [], whitelist_role_ids: [] }];
  await track(client, guild, { rule: 'bot_add', auditLogType: 28, targetId: 'newbot', actionLabel: 'bot added', inline: [{ kind: 'kick_bot', id: 'newbot' }] });
  assert.deepEqual(calls.map((c) => c[0]).sort(), ['kick', 'kick'], 'the account that added it and the bot are both kicked');
  assert.ok(calls.some((c) => c[1] === 'newbot'));

  // restore: what was kept comes back, a failure does not stop the rest
  const { restoreEvent, snapshotChannel, snapshotRole, canRestore } = require('../src/utils/antiNukeRestore');
  const made = [];
  const rguild = {
    id: 'g1', ownerId: 'owner',
    channels: { cache: { has: () => true, get: () => null }, create: async (o) => { if (o.name === 'boom') throw new Error('nope'); made.push(['channel', o.name]); } },
    roles: { cache: { has: (id) => id !== 'gone', get: () => ({ position: 1 }) }, create: async (o) => made.push(['role', o.name]) },
    members: { cache: { has: () => true }, unban: async (id) => made.push(['unban', id]), fetch: async () => ({ roles: { add: async (r) => made.push(['roles.add', r]) } }), me: { roles: { highest: { position: 10 } } } },
  };
  const result = await restoreEvent(rguild, {
    executor_id: 'u1', previous_roles: ['rA', 'gone'],
    restorable: [{ kind: 'channel', name: 'general', type: 0, overwrites: [] }, { kind: 'channel', name: 'boom', type: 0, overwrites: [] }, { kind: 'role', name: 'Mods', color: 0, permissions: '8' }, { kind: 'unban', userId: '5' }],
  });
  assert.deepEqual(made.map((m) => m[0]), ['role', 'channel', 'unban', 'roles.add'], 'roles come back before channels');
  assert.deepEqual(made[3][1], ['rA'], 'a role that no longer exists is skipped');
  assert.equal(result.failed.length, 1, 'one failure is reported and the rest still come back');

  // snapshots keep what is needed
  const snap = snapshotChannel({ name: 'x', type: 0, parentId: 'p', topic: 't', nsfw: false, rateLimitPerUser: 5, permissionOverwrites: { cache: new Map([['1', { id: '1', type: 0, allow: { bitfield: 8n }, deny: { bitfield: 0n } }]]) } });
  assert.deepEqual(snap.overwrites, [{ id: '1', type: 0, allow: '8', deny: '0' }]);
  assert.equal(snapshotRole({ name: 'r', color: 5, hoist: true, mentionable: false, permissions: { bitfield: 16n } }).permissions, '16');
  assert.equal(canRestore({ id: 'owner', guild: { ownerId: 'owner' }, permissions: { has: () => false } }), true);
  assert.equal(canRestore({ id: 'x', guild: { ownerId: 'owner' }, permissions: { has: () => false } }), false);

  console.log('antinuke ok');
})().catch((err) => { console.error(err); process.exit(1); });

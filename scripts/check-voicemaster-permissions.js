// The overwrites of a new temporary room: the old behavior stays by default, and the new options each do their part.
const path = require('node:path');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { buildOverwrites, startingFlags, privacyMode, ownerPermissionList } = require(path.join(__dirname, '..', 'src/utils/voiceMasterPermissions.js'));

const guild = { roles: { everyone: { id: 'E' } } };
const find = (list, id) => list.find((o) => o.id === id);
const has = (bits, flag) => (bits & flag) === flag;
const category = { permissionOverwrites: { cache: new Map([
  ['E', { id: 'E', type: 0, allow: { bitfield: 0n }, deny: { bitfield: P.Connect } }],
  ['TIER', { id: 'TIER', type: 0, allow: { bitfield: P.Connect | P.Speak }, deny: { bitfield: 0n } }],
]) } };

// Defaults: like before, everyone connects, the owner manages and moves.
let o = buildOverwrites({ guild, config: {}, ownerId: 'U' });
assert.ok(has(find(o, 'E').allow, P.Connect));
assert.ok(has(find(o, 'U').allow, P.ManageChannels | P.MoveMembers | P.Connect));
assert.ok(!has(find(o, 'U').allow, P.MuteMembers));
assert.deepEqual(startingFlags({}), { is_locked: false, is_ghosted: false });

// The category is only copied when asked, and its roles then stay.
o = buildOverwrites({ guild, config: {}, ownerId: 'U', parent: category });
assert.equal(find(o, 'TIER'), undefined, 'not copied when off');
o = buildOverwrites({ guild, config: { sync_category_permissions: true }, ownerId: 'U', parent: category });
assert.ok(has(find(o, 'TIER').allow, P.Connect | P.Speak), 'tier role copied');
assert.ok(has(find(o, 'E').deny, P.Connect) && !has(find(o, 'E').allow, P.Connect), 'public keeps the category rule for everyone');
assert.ok(has(find(o, 'U').allow, P.ManageChannels));
o = buildOverwrites({ guild, config: { sync_category_permissions: true }, ownerId: 'U', parent: category, syncCategory: false });
assert.equal(find(o, 'TIER'), undefined, 'fallback without the copy');

// Privacy modes.
o = buildOverwrites({ guild, config: { privacy_mode: 'locked' }, ownerId: 'U' });
assert.ok(has(find(o, 'E').deny, P.Connect) && has(find(o, 'E').allow, P.ViewChannel));
assert.deepEqual(startingFlags({ privacy_mode: 'locked' }), { is_locked: true, is_ghosted: false });
o = buildOverwrites({ guild, config: { privacy_mode: 'hidden' }, ownerId: 'U' });
assert.ok(has(find(o, 'E').deny, P.ViewChannel | P.Connect));
assert.deepEqual(startingFlags({ privacy_mode: 'hidden' }), { is_locked: true, is_ghosted: true });
assert.equal(privacyMode({ privacy_mode: 'nonsense' }), 'public');

// Access roles: only they get in, and the owner always can.
o = buildOverwrites({ guild, config: { access_role_ids: ['A', 'B'] }, ownerId: 'U' });
assert.ok(has(find(o, 'E').deny, P.ViewChannel | P.Connect));
assert.ok(has(find(o, 'A').allow, P.ViewChannel | P.Connect) && has(find(o, 'B').allow, P.Connect));
assert.ok(has(find(o, 'U').allow, P.Connect));

// Owner permissions from the settings; unknown names are ignored.
o = buildOverwrites({ guild, config: { owner_permissions: ['mute_members', 'manage_permissions', 'bogus'] }, ownerId: 'U' });
assert.ok(has(find(o, 'U').allow, P.MuteMembers | P.ManageRoles));
assert.ok(!has(find(o, 'U').allow, P.ManageChannels));
assert.deepEqual(ownerPermissionList({ owner_permissions: ['x'] }), []);
console.log('voicemaster permissions OK');

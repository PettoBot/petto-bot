// Checks who the bot may act on: a kick or a ban is judged by what Discord checks for it (kickable, bannable), so a bot with the
// Administrator permission whose role is below Petto's can be kicked. Only a timeout is refused for an administrator.
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const resolved = require.resolve(path.join(__dirname, '..', 'src/utils/permissions.js'));
const { canModerate, botCanAct } = require(resolved);

const has = (...flags) => ({ has: (flag) => flags.includes(flag) });
const guild = { ownerId: 'owner', members: { me: { id: 'me', permissions: has(PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers) } } };
const moderator = { id: 'mod', permissions: has(PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers), roles: { highest: { position: 10 } } };
const interaction = { member: moderator, user: { id: 'mod' }, guild };

// Another bot with an Administrator role, below Petto: Discord lets Petto kick and ban it, but not time it out.
const adminBot = { id: 'bot', kickable: true, bannable: true, moderatable: false, manageable: true, permissions: has(PermissionFlagsBits.Administrator), roles: { highest: { position: 5 } } };
assert.deepEqual(canModerate(interaction, adminBot, PermissionFlagsBits.KickMembers), { ok: true }, 'a bot with admin can be kicked');
assert.deepEqual(canModerate(interaction, adminBot, PermissionFlagsBits.BanMembers), { ok: true }, 'and banned');
assert.deepEqual(canModerate(interaction, adminBot, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' }), { ok: true }, 'a warning does not touch the member');
const timeout = canModerate(interaction, adminBot, PermissionFlagsBits.ModerateMembers);
assert.equal(timeout.ok, false);
assert.match(timeout.message, /Administrator permission/, 'a timeout of an administrator says why');

// A member above Petto cannot be kicked or banned, and the message says which action
const above = { ...adminBot, kickable: false, bannable: false, moderatable: false, permissions: has() };
assert.match(canModerate(interaction, above, PermissionFlagsBits.KickMembers).message, /cannot kick this member/);
assert.match(canModerate(interaction, above, PermissionFlagsBits.BanMembers).message, /cannot ban this member/);
assert.match(canModerate(interaction, above, PermissionFlagsBits.ModerateMembers).message, /highest role is above or equal to mine/);

// The moderator's own role still counts, and the owner is never a target
assert.match(canModerate(interaction, { ...adminBot, roles: { highest: { position: 10 } } }, PermissionFlagsBits.KickMembers).message, /equal to or higher than yours/);
assert.match(canModerate(interaction, { ...adminBot, id: 'owner' }, PermissionFlagsBits.KickMembers).message, /server owner/);
assert.equal(botCanAct(adminBot, 'none'), null);

console.log('Checked the moderation hierarchy: kicks and bans of administrators, timeouts and the messages.');

// Checks /channel copyperms: replacing and merging the permission overwrites of a channel, and that the command is registered with its options.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const channel = require('../src/commands/moderation/channel.js');

const source = [{ id: 'role1', type: 0, allow: 1n, deny: 0n }, { id: 'role2', type: 0, allow: 0n, deny: 4n }];
const current = [{ id: 'role2', type: 0, allow: 8n, deny: 0n }, { id: 'user3', type: 1, allow: 2n, deny: 0n }];
assert.deepEqual(channel.copiedOverwrites(source, current, false), source, 'replace: only the ones of the source');
const merged = channel.copiedOverwrites(source, current, true);
assert.deepEqual(merged.map((entry) => entry.id).sort(), ['role1', 'role2', 'user3'], 'merge: the ones it had and the ones of the source');
assert.deepEqual(merged.find((entry) => entry.id === 'role2'), source[1], 'merge: for the same role the source wins');
assert.deepEqual(merged.find((entry) => entry.id === 'user3'), current[1], 'merge: what the source does not mention stays');

const sub = channel.data.toJSON().options.find((option) => option.name === 'copyperms');
assert.ok(sub, '/channel copyperms exists');
assert.deepEqual(sub.options.map((option) => [option.name, Boolean(option.required)]), [['from', true], ['to', false], ['merge', false]]);
assert.ok(channel.data.toJSON().options.length <= 25, '/channel stays within the 25 subcommands Discord allows');
console.log('check-channel-copyperms: ok');

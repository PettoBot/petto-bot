// Checks what is done with the channels Discord hides from the bot (`___hidden___`, flag 1 << 17): they are not in a backup, are not matched or deleted by a restore, are not in
// the lists the dashboard reads, and the backup says how many were left out.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isObfuscatedChannel, visibleChannels, countObfuscated, CHANNEL_OBFUSCATED } = require('../src/utils/hiddenChannels');
const { buildSnapshot } = require('../src/utils/guildSnapshots');

assert.equal(CHANNEL_OBFUSCATED, 1 << 17);
assert.ok(isObfuscatedChannel({ name: 'x', flags: { bitfield: 1 << 17 } }), 'the flag');
assert.ok(isObfuscatedChannel({ name: 'x', flags: 1 << 17 | 4 }), 'the flag among others');
assert.ok(isObfuscatedChannel({ name: '___hidden___', flags: { bitfield: 0 } }), 'the name');
assert.ok(!isObfuscatedChannel({ name: 'general', flags: { bitfield: 1 << 4 } }) && !isObfuscatedChannel({ name: 'general' }) && !isObfuscatedChannel(null), 'a normal channel');
const list = [{ id: '1', name: 'general' }, { id: '2', name: '___hidden___' }, { id: '3', name: 'x', flags: { bitfield: 1 << 17 } }];
assert.deepEqual(visibleChannels(list).map((channel) => channel.id), ['1']);
assert.equal(countObfuscated(list), 2);

// The copy the dashboard reads.
const channel = (id, name, flags = 0) => ({ id, name, type: 0, rawPosition: Number(id), parentId: null, flags: { bitfield: flags }, isThread: () => false, permissionsFor: () => null });
const snapshot = buildSnapshot({ id: '9', name: 'S', channels: { cache: new Map([['1', channel('1', 'general')], ['2', channel('2', '___hidden___', 1 << 17)]]) }, roles: { cache: new Map() }, emojis: { cache: new Map() }, members: { me: null } });
assert.deepEqual(snapshot.channels.map((each) => each.name), ['general'], 'the dashboard does not list a hidden channel');

// The source of the backup, the restore and the lists of the dashboard.
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(/isObfuscatedChannel\(channel\)/.test(read('src/commands/config/backup.js')) && /backup\.created\.hidden/.test(read('src/commands/config/backup.js')), 'the backup leaves them out and says so');
assert.ok(/!isObfuscatedChannel\(channel\) && RESTORABLE_CHANNEL_TYPES/.test(read('src/utils/backupRestore.js')), 'a restore neither matches nor deletes them');
assert.ok(/isObfuscatedChannel/.test(read('src/web/identityRoutes.js')) && /isObfuscatedChannel/.test(read('src/web/forumRoutes.js')), 'the pickers of the dashboard');
console.log('Hidden channel checks passed (backup, restore and the lists of the dashboard).');

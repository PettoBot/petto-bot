// PETTO_OWNER_ID holds one id or several (commas, spaces or semicolons), with quotes or a mention around an id ignored; the first one is `ownerId` and all of them are
// `ownerIds`. Nothing valid in it: the default owner. Each case loads the settings in its own process, as the host does.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT = '293504726505357312';
const read = (value) => JSON.parse(execFileSync(process.execPath, ['-e', "const c = require('./src/config'); process.stdout.write(JSON.stringify({ ownerId: c.ownerId, ownerIds: c.ownerIds }));"], {
  cwd: path.join(__dirname, '..'),
  env: { PATH: process.env.PATH, DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: '1', DISCLOUD_DATABASE_URL: 'postgres://u:p@localhost/db', PETTO_OWNER_ID: value },
  encoding: 'utf8',
}));

assert.deepEqual(read('285568675631595521,293504726505357312'), { ownerId: '285568675631595521', ownerIds: ['285568675631595521', '293504726505357312'] });
assert.deepEqual(read('"293504726505357312"'), { ownerId: DEFAULT, ownerIds: [DEFAULT] });
assert.deepEqual(read(' 285568675631595521 ; <@293504726505357312> '), { ownerId: '285568675631595521', ownerIds: ['285568675631595521', '293504726505357312'] });
assert.deepEqual(read('285568675631595521 285568675631595521'), { ownerId: '285568675631595521', ownerIds: ['285568675631595521'] });
assert.deepEqual(read(''), { ownerId: DEFAULT, ownerIds: [DEFAULT] });
assert.deepEqual(read('not an id'), { ownerId: DEFAULT, ownerIds: [DEFAULT] });
console.log('Owner ids checks passed (one or several ids, quotes and mentions ignored, the default when none is valid).');

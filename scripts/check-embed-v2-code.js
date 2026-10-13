// Checks that `/embed create code:` reads a Components V2 share code (`p2.`), and nothing else as one.
const assert = require('node:assert/strict');
const path = require('node:path');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { prefix: '!' });
stub('src/db/database.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const { readV2Code } = require('../src/commands/config/embed');
const toCode = (value) => 'p2.' + Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const design = { components: [{ type: 17, components: [{ type: 10, content: 'Hi {user.mention}' }] }] };
assert.deepEqual(readV2Code(toCode(design)), design);
assert.deepEqual(readV2Code(`  ${toCode(design)}  `), design, 'spaces around the code are fine');
assert.equal(readV2Code('{embed}&v{title: Hello}'), null, 'the usual embed code is not a V2 code');
assert.equal(readV2Code('p2.%%%'), null, 'a broken code');
assert.equal(readV2Code(toCode({ components: 'no' })), null, 'components must be a list');
assert.equal(readV2Code(toCode({ components: [1] })), null, 'every component must be an object');
console.log('Checked the V2 share codes of /embed create: read, trimmed and refused when they are not one.');

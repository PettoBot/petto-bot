// `!prefix ?` and `!prefix set ?` both set the prefix `?`; a prefix with a space is still refused.
const assert = require('node:assert/strict');
const { readPrefixInput, isValidPrefix } = require('../src/utils/prefixInput');

assert.equal(readPrefixInput('?'), '?');
assert.equal(readPrefixInput('set ?'), '?');
assert.equal(readPrefixInput('SET  ?'), '?');
assert.equal(readPrefixInput('  ,  '), ',');
assert.equal(readPrefixInput('settle'), 'settle', 'a prefix that starts with the letters set is not cut');
assert.equal(readPrefixInput('set'), 'set', 'only the word set is the prefix set');
assert.equal(isValidPrefix('?'), true);
assert.equal(isValidPrefix('set ?'), false);
assert.equal(isValidPrefix('abcdef'), false);
assert.equal(isValidPrefix(readPrefixInput('set a b')), false, 'a space inside is refused');
assert.equal(isValidPrefix(''), false);
console.log('prefix input ok');

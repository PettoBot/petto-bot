// What goes out with a transcript: the link, the file or both, as the server chose.
const assert = require('node:assert/strict');
const { transcriptParts, TRANSCRIPT_MODES } = require('../src/utils/transcriptDelivery');

assert.deepEqual(TRANSCRIPT_MODES, ['auto', 'link', 'file', 'both']);
assert.deepEqual(transcriptParts('auto', true), { link: true, file: false }, 'auto with a link: only the link (as always)');
assert.deepEqual(transcriptParts('auto', false), { link: false, file: true }, 'auto without a link: the file, so nothing is lost');
assert.deepEqual(transcriptParts('link', true), { link: true, file: false });
assert.deepEqual(transcriptParts('link', false), { link: false, file: true }, 'link without a viewer falls back to the file');
assert.deepEqual(transcriptParts('file', true), { link: false, file: true });
assert.deepEqual(transcriptParts('both', true), { link: true, file: true });
assert.deepEqual(transcriptParts('both', false), { link: false, file: true });
assert.deepEqual(transcriptParts(undefined, true), { link: true, file: false }, 'an unknown or missing value is auto');
assert.deepEqual(transcriptParts('nonsense', false), { link: false, file: true });
console.log('Transcript delivery check passed.');

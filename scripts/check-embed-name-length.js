// An embed name goes into the custom id of every button of the editor (`eb_description::<user id>::<name>`), and Discord refuses a custom id of
// more than 100 characters ("Invalid string length"). This checks that the longest name allowed fits, and that a name saved before the limit
// does not make the panel throw.
const assert = require('node:assert/strict');
const path = require('node:path');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
const { MAX_NAME_LENGTH } = require('../src/utils/embedNameLimit');
const { renderPanel } = require('../src/interactions/embedPanel');

(async () => {
  assert.ok(MAX_NAME_LENGTH > 0 && MAX_NAME_LENGTH <= 60, 'the limit leaves room for the longest button id');

  // The longest name allowed, with the longest user id (20 digits), still builds every button.
  const userId = '1'.repeat(20);
  for (const lang of ['en', 'es', 'pt-BR']) {
    const panel = await renderPanel({ data: {} }, 'a'.repeat(MAX_NAME_LENGTH), userId, '/embed preview', lang);
    const ids = panel.components.flatMap((row) => row.components.map((button) => button.data.custom_id));
    assert.ok(ids.length >= 10, 'the editor has its buttons');
    assert.ok(ids.every((id) => id.length <= 100), 'every custom id fits in 100 characters');
  }

  // A name saved before the limit existed: no throw, and the answer says what to do (in each language).
  for (const lang of ['en', 'es', 'pt-BR']) {
    const panel = await renderPanel({ data: {} }, 'b'.repeat(90), userId, '/embed preview', lang);
    assert.deepEqual(panel.components, []);
    assert.ok(panel.content.includes('b'.repeat(90)) && panel.content.includes(String(MAX_NAME_LENGTH)), `it names the embed and the limit (${lang})`);
  }
  console.log('Checked the embed name length against the editor buttons.');
})().catch((error) => { console.error(error); process.exit(1); });

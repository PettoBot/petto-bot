// The filters the dashboard sends to the database API, including the negated ones like code=not.is.null.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { dashboard: {}, web: {} });
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/db/postgres.js', { createPostgresClient() {}, getPrimaryPool() {} });
const { parseFilter } = require('../src/web/dashboardDatabase');

assert.deepEqual(parseFilter('eq.5'), { operator: 'eq', value: '5' });
assert.deepEqual(parseFilter('is.null'), { operator: 'is', value: 'null' });
assert.deepEqual(parseFilter('not.is.null'), { operator: 'is', value: 'null', negated: true });
assert.deepEqual(parseFilter('not.in.(a,b)'), { operator: 'in', value: ['a', 'b'], negated: true });
assert.deepEqual(parseFilter('NOT.eq.x'), { operator: 'eq', value: 'x', negated: true });
assert.throws(() => parseFilter('not.bogus.1'), /Invalid PostgreSQL filter/);
assert.throws(() => parseFilter('bogus.1'), /Invalid PostgreSQL filter/);
assert.throws(() => parseFilter('code'), /Invalid PostgreSQL filter/);

console.log('Checked the dashboard filters: plain, negated and invalid.');

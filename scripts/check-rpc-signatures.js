// Every database function the bot calls has to be in the list of functions the database layer allows, with the same
// arguments: a missing one fails at run time with "Unsupported PostgreSQL RPC" and an argument that is not listed is dropped silently.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/db/postgres.js'), 'utf8');
const block = source.slice(source.indexOf('const RPC_SIGNATURES = {'), source.indexOf('};', source.indexOf('const RPC_SIGNATURES = {')));
const signatures = {};
for (const match of block.matchAll(/^\s*(\w+):\s*\{\s*args:\s*\[([^\]]*)\]/gm)) signatures[match[1]] = [...match[2].matchAll(/'(\w+)'/g)].map((m) => m[1]);
assert.ok(Object.keys(signatures).length > 8, 'the list was read');

// The functions called by name anywhere in the code.
const used = new Set();
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) for (const match of fs.readFileSync(full, 'utf8').matchAll(/\.rpc\('(\w+)'/g)) used.add(match[1]);
  }
})(path.join(__dirname, '../src'));
for (const name of used) assert.ok(signatures[name], `${name} is called but is not in RPC_SIGNATURES`);

// The counters that choose the function at run time: what they send has to be what the list takes.
const stub = (file, exports) => { const full = path.resolve(__dirname, file); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const calls = [];
stub('../src/db/database.js', { rpc: async (name, params) => { calls.push([name, params]); return { error: null }; }, from: () => ({}) });
stub('../src/db/guilds.js', { ensureGuild: async () => {} });
const detail = require('../src/db/activityDetail');

(async () => {
  detail.queueMessage('g', 'u');
  detail.queueVoice('g', 'u', 60);
  detail.queueFlow('g', { joins: 1, leaves: 1, invited: 1 });
  await detail.flush();
  const names = new Set(calls.map(([name]) => name));
  for (const name of ['increment_activity_hourly', 'increment_activity_member', 'increment_member_flow']) assert.ok(names.has(name), `${name} was called`);
  for (const [name, params] of calls) {
    assert.ok(signatures[name], `${name} is in the list`);
    assert.deepEqual(Object.keys(params).sort(), [...signatures[name]].sort(), `${name} sends exactly the arguments the list takes`);
  }
  // The functions with arguments that were added later.
  assert.ok(signatures.increment_invite_stat.includes('p_fake_delta') && signatures.increment_invite_stat.includes('p_bonus_delta'), 'the invite counters take fake and bonus');
  assert.ok(signatures.create_mod_case.includes('p_source'), 'a case keeps who applied it');
  console.log('Checked that every database function the bot calls is allowed with the right arguments.');
})();

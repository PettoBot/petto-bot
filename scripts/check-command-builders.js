// Loads every command and builds its slash data, so a description over 100 characters (or any other builder error) fails here
// instead of stopping the bot when it starts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Some commands read the configuration when they load; a made-up value is enough to build their data.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to

const resolved = require.resolve('../src/db/database');
require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { from: () => ({}) } };

const tooLong = (node, trail) => {
  const found = [];
  if ((node.description ?? '').length > 100) found.push(`${trail} (${node.description.length})`);
  for (const option of node.options ?? []) found.push(...tooLong(option, `${trail}/${option.name}`));
  return found;
};

const root = path.join(__dirname, '..', 'src', 'commands');
const problems = [];
for (const category of fs.readdirSync(root)) {
  const dir = path.join(root, category);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    try {
      const command = require(path.join(dir, file));
      if (command?.data?.toJSON) problems.push(...tooLong(command.data.toJSON(), `${category}/${file}`));
    } catch (err) {
      problems.push(`${category}/${file} throws: ${String(err.message).split('\n')[0]}`);
    }
  }
}
assert.deepEqual(problems, [], `Some commands cannot be built:\n${problems.join('\n')}`);
console.log('Checked that every command builds and its descriptions fit.');

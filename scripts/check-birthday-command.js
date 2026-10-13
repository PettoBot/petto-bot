// Checks that /birthday can be typed with the prefix (`!birthday set 25 12 2007`): the prefix reads the options by position.
// The database is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
for (const file of ['src/db/birthdays.js', 'src/db/embedTemplates.js', 'src/db/guilds.js', 'src/utils/roleResolve.js', 'src/utils/userResolve.js']) stub(file, {});
stub('src/utils/roleResolve.js', { resolveRole: (guild, token) => ({ id: String(token).replace(/\D/g, '') || '1' }) });
const command = require('../src/commands/utility/birthday.js');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');

const message = {
  guild: { id: '1', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection() } },
  author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '',
};
const parse = (text) => buildInteractionFromMessage(message, command, text);

(async () => {
  assert.deepEqual(command.data.toJSON().options.map((option) => option.name), ['set', 'remove', 'view', 'upcoming', 'config']);
  let i = await parse('set 25 12 2007');
  assert.equal(i.options.getSubcommand(), 'set');
  assert.deepEqual([i.options.getInteger('day'), i.options.getInteger('month'), i.options.getInteger('year')], [25, 12, 2007]);
  i = await parse('set 1 2');
  assert.deepEqual([i.options.getInteger('day'), i.options.getInteger('month'), i.options.getInteger('year')], [1, 2, null], 'the year is optional');
  i = await parse('config --hour 9 --timezone UTC-5 --enabled true');
  assert.equal(i.options.getSubcommand(), 'config');
  assert.deepEqual([i.options.getInteger('hour'), i.options.getString('timezone'), i.options.getBoolean('enabled')], [9, 'UTC-5', true]);
  i = await parse('config --message "Happy birthday {user}!"');
  assert.equal(i.options.getString('message'), 'Happy birthday {user}!');
  console.log('Checked /birthday with the prefix: set, config and its options.');
})().catch((error) => { console.error(error); process.exit(1); });

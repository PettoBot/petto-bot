// The server of the private team controls: the operations server when one is set, else the support server, else the one of the join-log channel.
const assert = require('node:assert/strict');
const path = require('node:path');

const configPath = require.resolve('../src/config');
const use = (config) => { require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: config }; delete require.cache[require.resolve('../src/utils/opsGuild')]; return require('../src/utils/opsGuild').resolveOpsGuildId; };
const client = { channels: { fetch: async (id) => (id === 'J' ? { guildId: 'JOINGUILD' } : null) } };

(async () => {
  assert.equal(await use({ opsGuildId: 'OPS', supportGuildId: 'SUP', opsChannels: { joinLog: 'J' } })(client), 'OPS', 'the operations server wins');
  assert.equal(await use({ opsGuildId: null, supportGuildId: 'SUP', opsChannels: { joinLog: 'J' } })(client), 'SUP', 'then the support server');
  assert.equal(await use({ opsGuildId: null, supportGuildId: null, opsChannels: { joinLog: 'J' } })(client), 'JOINGUILD', 'then the server of the join-log channel');
  assert.equal(await use({ opsGuildId: null, supportGuildId: null, opsChannels: { joinLog: 'X' } })(client), null, 'and nothing when there is none');
  console.log('Checked the server of the private team controls.');
})().catch((error) => { console.error(error); process.exit(1); });

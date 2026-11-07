// Which server `/server info` tells about: the one where it is written, or the one whose ID is given (a member of it, or the team of Petto).
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { ownerId: 'owner1', developerIds: ['dev1'] });
const { findServerForInfo, cleanServerId } = require('../src/utils/serverLookup');
(async () => {
  assert.equal(cleanServerId(' <123456789012345678> '), '123456789012345678');
  assert.equal(cleanServerId('"123456789012345678",'), '123456789012345678');
  assert.equal(cleanServerId('petto land'), null);
  const mk = (members) => ({ id: '222222222222222222', members: { cache: new Map(), fetch: async (id) => { if (members === 'error') { const e = new Error('x'); e.code = 50013; throw e; } if (!members.includes(id)) { const e = new Error('Unknown Member'); e.code = 10007; throw e; } return { id }; } } });
  const client = (guild) => ({ guilds: { cache: new Map(guild ? [[guild.id, guild]] : []), fetch: async () => { throw new Error('unknown'); } } });
  const here = { id: '111111111111111111' };
  assert.deepEqual(await findServerForInfo({ client: client(), wanted: '', userId: 'u', current: here }), { guild: here });
  assert.deepEqual(await findServerForInfo({ client: client(), wanted: here.id, userId: 'u', current: here }), { guild: here });
  assert.equal((await findServerForInfo({ client: client(), wanted: 'a name', userId: 'u', current: here })).error, 'bad_id');
  assert.equal((await findServerForInfo({ client: client(), wanted: '333333333333333333', userId: 'u', current: here })).error, 'not_found');
  const other = mk(['member1']);
  assert.equal((await findServerForInfo({ client: client(other), wanted: other.id, userId: 'member1', current: here })).guild, other, 'a member');
  assert.equal((await findServerForInfo({ client: client(other), wanted: `<${other.id}>`, userId: 'member1', current: here })).guild, other, 'an ID pasted with brackets');
  assert.equal((await findServerForInfo({ client: client(other), wanted: other.id, userId: 'stranger', current: here })).error, 'not_found', 'not a member');
  assert.equal((await findServerForInfo({ client: client(other), wanted: other.id, userId: 'owner1', current: here })).guild, other, 'the owner of Petto');
  assert.equal((await findServerForInfo({ client: client(other), wanted: other.id, userId: 'dev1', current: here })).guild, other, 'a developer');
  assert.equal((await findServerForInfo({ client: client(mk('error')), wanted: other.id, userId: 'member1', current: here })).error, 'unavailable', 'Discord failing is not "not a member"');
  console.log('Checked which server /server info tells about: this one, one by ID for a member, any one for the team, and the messages that say why not.');
})().catch((e) => { console.error(e); process.exit(1); });

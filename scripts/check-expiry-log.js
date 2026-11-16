// The log of a sanction that ends by itself (a timed mute or ban whose time is up, a jail released) says who it is about like the log of a new
// sanction does: the name, the ID and the avatar come from the real user, also when the person left or was banned and is not in the cache.
// Everything runs against fakes: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');

const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const resolvedDb = require.resolve('../src/db/database');
require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: () => ({}) } };

const logged = [];
const pending = [{ guild_id: 'g1', case_number: 7, user_id: 'u-mute', type: 'tempmute' }, { guild_id: 'g1', case_number: 8, user_id: 'u-ban', type: 'tempban' }, { guild_id: 'g1', case_number: 9, user_id: 'u-gone', type: 'tempban' }];
stub('../src/db/modActions', {
  getExpiredSanctions: async () => pending,
  deactivateCase: async () => {},
  createCase: async (row) => ({ ...row, case_number: 100 }),
});
stub('../src/db/jail', { getExpiredJails: async () => [], removeJailed: async () => {} });
stub('../src/db/tempRoles', { getExpiredTempRoles: async () => [], removeTempRole: async () => {} });
stub('../src/utils/jail', { unjailMember: async () => ({ ok: false }), JailError: class extends Error {} });
stub('../src/utils/sanctionTemplates', { sanctionDM: async () => ({}) });
stub('../src/utils/dmOrigin', { sendDm: async () => {} });
stub('../src/utils/caseLog', { logSanction: async (client, guild, data) => { logged.push(data); } });
const i18n = require('../src/i18n');
i18n.guildLanguage = async () => 'en';

const { processExpiredSanctions } = require('../src/jobs/expireSanctions');

const users = new Map([
  ['u-mute', { id: 'u-mute', username: 'muted-person', displayAvatarURL: () => 'https://cdn/muted.png' }],
  ['u-ban', { id: 'u-ban', username: 'banned-person', displayAvatarURL: () => 'https://cdn/banned.png' }],
]);
const guild = {
  id: 'g1',
  members: {
    fetch: async (id) => (id === 'u-mute' ? { timeout: async () => {} } : null),
    unban: async () => {},
  },
};
const client = {
  user: { id: 'bot' },
  guilds: { fetch: async () => guild },
  users: { fetch: async (id) => { const user = users.get(id); if (!user) throw new Error('Unknown User'); return user; } },
};

(async () => {
  await processExpiredSanctions(client);
  assert.equal(logged.length, 3);
  const byId = Object.fromEntries(logged.map((entry) => [entry.target.id, entry]));
  assert.equal(byId['u-mute'].target.username, 'muted-person', 'the unmute log has the name');
  assert.equal(byId['u-mute'].target.displayAvatarURL(), 'https://cdn/muted.png', 'and the avatar');
  assert.equal(byId['u-ban'].target.username, 'banned-person', 'the unban log of someone who is not a member has the name too');
  assert.equal(byId['u-gone'].target.id, 'u-gone', 'an account Discord no longer knows still gets a log, with the ID');
  assert.equal(byId['u-gone'].target.username, undefined);
  assert.ok(logged.every((entry) => entry.source === 'expiry' && entry.moderator.id === 'bot'));
  console.log('Expiry log checks passed (name and avatar of the unmuted and unbanned user, the ID alone when Discord has no such account).');
})().catch((err) => { console.error(err); process.exit(1); });

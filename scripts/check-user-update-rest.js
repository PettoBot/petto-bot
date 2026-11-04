// A change of avatar or username of a user is logged in the servers where the member is known, and it NEVER asks Discord about the others: before, every servers without the member
// in the cache got a request (up to one for each server for a single new avatar, nearly all answered 404), which filled the queue of requests of the bot. Discord and the
// log sender are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const logged = [];
stub('src/logging/engine.js', { sendLog: async (client, guildId, kind) => { logged.push([guildId, kind]); }, getAvatar: () => 'https://cdn.example/a.png', fetchMod: async () => null, fetchEntry: async () => null, AuditLogEvent: {} });
stub('src/logging/extraLog.js', { handleBotAdded: async () => {}, handleBotRemoved: async () => {} });
stub('src/utils/inviteResolve.js', { resolveJoinInvite: async () => null });
stub('src/i18n/index.js', { t: (lang, key) => `[${key}]`, tn: (lang, key) => `[${key}]`, guildLanguage: async () => 'en', formatNumber: (lang, n) => String(n) });
const { handleUserUpdate } = require('../src/logging/memberLog');

let fetches = 0;
const guild = (id, hasMember) => ({ id, members: { cache: { has: (userId) => hasMember && userId === 'u1' }, fetch: async () => { fetches += 1; throw new Error('Unknown Member'); } } });
const user = (username, avatar) => ({ id: 'u1', username, displayAvatarURL: () => `https://cdn.example/${avatar}.png` });

(async () => {
  const guilds = new Map(Array.from({ length: 60 }, (_, i) => [String(i), guild(String(i), i === 3 || i === 17)]));
  const client = { guilds: { cache: guilds } };
  await handleUserUpdate(user('old', 'a'), user('new', 'a'), client);
  assert.equal(fetches, 0, 'Discord is not asked about any server');
  assert.deepEqual(logged.map((entry) => entry[0]).sort(), ['17', '3'], 'the username change is logged where the member is known');
  assert.ok(logged.every((entry) => entry[1] === 'members'));

  // The same real change twice in a row is logged once, and a change that is not an avatar or a username is ignored.
  logged.length = 0;
  await handleUserUpdate(user('old', 'a'), user('new', 'a'), client);
  assert.equal(logged.length, 0, 'the second copy of the same change is ignored');
  await handleUserUpdate(user('same', 'b'), user('same', 'b'), client);
  assert.equal(logged.length, 0, 'nothing changed');
  assert.equal(fetches, 0);
  console.log('Checked the user update log: the servers where the member is known are logged and no server is asked about.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

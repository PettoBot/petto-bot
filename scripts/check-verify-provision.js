// The verification the dashboard sets up now: roles, channel, panel and the switch, with Discord and the storage replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let stored = {};
const patches = [];
stub('src/db/verificationConfig.js', {
  getConfig: async () => stored,
  upsertConfig: async (_id, patch) => { patches.push(patch); stored = { ...stored, ...patch }; return stored; },
});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
let gate = 0;
stub('src/utils/verifyRole.js', { ensureUnverifiedRole: async (guild, settings) => { gate += 1; if (!settings.unverified_role_id) stored = { ...stored, unverified_role_id: 'gate' }; return { id: 'gate', name: 'Unverified' }; } });
const posted = [];
stub('src/utils/verifyPanel.js', { postPanel: async (guild, settings, channel) => { if (!channel) throw new Error('I need to see and write in that channel, and the Manage Roles permission.'); posted.push(channel.id); } });

const { setupEverything, sendPanelNow, setEnabled } = require('../src/utils/verifyProvision');

function makeGuild({ perms = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels] } = {}) {
  const channels = new Map();
  return {
    id: '111111111111111111',
    members: { me: { permissions: { has: (flag) => perms.includes(flag) } } },
    roles: { cache: new Map(), everyone: { id: 'everyone' }, create: async ({ name }) => { const role = { id: `role-${name}`, name }; return role; } },
    channels: { fetch: async (id) => channels.get(id) ?? null, create: async ({ name }) => { const channel = { id: `chan-${name}`, name }; channels.set(channel.id, channel); return channel; } },
  };
}

(async () => {
  // From nothing: the role for who passes, the gate, the channel and the panel, all at once, and the verification on.
  const guild = makeGuild();
  let result = await setupEverything(guild);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(posted, ['chan-verify']);
  assert.equal(stored.enabled, true);
  assert.equal(stored.verified_role_id, 'role-Verified');
  assert.equal(stored.panel_channel_id, 'chan-verify');
  assert.ok(result.message.includes('#verify'));

  // Pressing it again does not make a second channel or role: what is there is kept.
  const before = JSON.stringify(stored);
  guild.roles.cache.set('role-Verified', {});
  result = await setupEverything(guild);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(stored), before);

  // Posting the panel on its own.
  posted.length = 0;
  result = await sendPanelNow(guild);
  assert.deepEqual([result.ok, posted], [true, ['chan-verify']]);
  stored = { ...stored, panel_channel_id: null };
  assert.equal((await sendPanelNow(guild)).ok, false, 'no channel, no panel');

  // The switch.
  assert.equal((await setEnabled(guild, false)).ok, true);
  assert.equal(stored.enabled, false);
  const gateBefore = gate;
  assert.equal((await setEnabled(guild, true)).ok, true);
  assert.equal(gate, gateBefore + 1, 'turning it on makes sure the gate role exists');

  // Without the permissions it says so and changes nothing.
  stored = {};
  const poor = makeGuild({ perms: [] });
  assert.equal((await setupEverything(poor)).message, 'I need the Manage Roles permission.');
  assert.equal((await setEnabled(poor, true)).ok, false);
  const noChannels = makeGuild({ perms: [PermissionFlagsBits.ManageRoles] });
  assert.equal((await setupEverything(noChannels)).message, 'I need the Manage Channels permission to make the channel.');
  console.log('verify provision ok');
})().catch((err) => { console.error(err); process.exit(1); });

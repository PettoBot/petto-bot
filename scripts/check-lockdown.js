// The lockdown: what it closes, what it puts back, and the job that ends it.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { ChannelType, GuildVerificationLevel, PermissionFlagsBits } = require('discord.js');
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let config = { channel_ids: [], pause_invites: true, raise_verification: true, auto_end_minutes: 0, announce_channel_id: 'news', message: null };
let active = null;
const guildUpdates = [];
const logs = [];
stub('../src/db/lockdown', {
  getConfig: async () => config, getActive: async () => active, saveActive: async (row) => { active = row; }, clearActive: async () => { active = null; },
  listDue: async (now) => (active && active.ends_at && active.ends_at <= now ? [active] : []),
});
stub('../src/db/guilds', { ensureGuild: async () => {}, updateGuild: async (id, patch) => guildUpdates.push(patch) });
stub('../src/logging/engine', { sendLog: async (_c, _g, _e, embed) => logs.push(embed.author?.name) });

const { startLockdown, endLockdown, stateOf } = require('../src/utils/lockdown');
const { checkLockdowns } = require('../src/jobs/lockdownJob');

const edits = [];
function channel(id, type, overwrite) {
  return {
    id, type,
    permissionOverwrites: {
      cache: new Map(overwrite ? [['g1', overwrite]] : []),
      edit: async (_role, perms) => { if (id === 'broken') throw new Error('Missing Permissions'); edits.push([id, perms]); },
    },
    send: async () => edits.push([id, 'announce']),
  };
}
const flags = (...names) => ({ has: (f) => names.some((n) => PermissionFlagsBits[n] === f) });
const channels = new Map([
  ['general', channel('general', ChannelType.GuildText, null)],
  ['chat', channel('chat', ChannelType.GuildText, { allow: flags('SendMessages'), deny: flags() })],
  ['rules', channel('rules', ChannelType.GuildText, { allow: flags(), deny: flags('SendMessages') })],
  ['voice', channel('voice', ChannelType.GuildVoice, null)],
  ['broken', channel('broken', ChannelType.GuildText, null)],
  ['news', channel('news', ChannelType.GuildAnnouncement, null)],
]);
let level = GuildVerificationLevel.Low;
const invites = [{ delete: async () => {} }, { delete: async () => {} }];
const guild = {
  id: 'g1', roles: { everyone: { id: 'g1' } }, channels: { cache: channels }, verificationLevel: level,
  members: { me: { permissions: { has: () => true } } },
  invites: { fetch: async () => invites },
  setVerificationLevel: async (l) => { level = l; guild.verificationLevel = l; },
  client: { user: { id: 'petto' } },
};

(async () => {
  assert.deepEqual(stateOf(channels.get('chat'), 'g1').SendMessages, true);
  assert.deepEqual(stateOf(channels.get('rules'), 'g1').SendMessages, false);
  assert.equal(stateOf(channels.get('general'), 'g1').SendMessages, null);

  const result = await startLockdown(guild, { startedBy: 'mod1', reason: 'raid', minutes: 30 });
  assert.equal(result.locked, 4, 'general, chat, rules and news are closed; voice is not a text channel');
  assert.equal(result.failed, 1, 'a channel it cannot edit is counted, not fatal');
  assert.equal(result.invitesDeleted, 2);
  assert.equal(level, GuildVerificationLevel.High, 'the verification is raised');
  assert.ok(guildUpdates.some((u) => u.invites_paused_until), 'invites are paused');
  assert.equal(active.previous_level, GuildVerificationLevel.Low);
  assert.ok(active.ends_at, 'it ends by itself after the minutes');
  assert.deepEqual(active.locked.find((l) => l.id === 'chat').previous.SendMessages, true, 'what each channel had is kept');
  assert.ok(edits.some((e) => e[0] === 'news' && e[1] === 'announce'), 'the notice is posted');
  assert.ok(logs.includes('Lockdown started'));
  await assert.rejects(startLockdown(guild, { startedBy: 'mod1' }), /already on/);

  edits.length = 0; guildUpdates.length = 0;
  const ended = await endLockdown(guild, { endedBy: 'mod1' });
  assert.equal(ended.restored, 4);
  assert.equal(edits.find((e) => e[0] === 'chat')[1].SendMessages, true, 'a channel that allowed it allows it again');
  assert.equal(edits.find((e) => e[0] === 'rules')[1].SendMessages, false, 'a channel that denied it still denies it');
  assert.equal(edits.find((e) => e[0] === 'general')[1].SendMessages, null, 'a channel that had nothing set goes back to nothing');
  assert.equal(level, GuildVerificationLevel.Low, 'the verification goes back');
  assert.ok(guildUpdates.some((u) => u.invites_paused_until === null), 'the invites are free again');
  assert.equal(active, null);
  await assert.rejects(endLockdown(guild), /no lockdown/);

  // only the chosen channels, nothing raised, no end time
  config = { ...config, channel_ids: ['general'], raise_verification: false, pause_invites: false, announce_channel_id: null };
  edits.length = 0;
  const only = await startLockdown(guild, { startedBy: 'mod1' });
  assert.equal(only.locked, 1);
  assert.equal(level, GuildVerificationLevel.Low);
  assert.equal(active.ends_at, null, 'it stays until someone ends it');
  assert.equal(active.invites_paused, false);
  await endLockdown(guild, { endedBy: 'mod1' });

  // the job ends the ones whose time is up, and only those
  const clientLike = { guilds: { cache: new Map([['g1', guild]]) } };
  await startLockdown(guild, { startedBy: 'mod1', minutes: 1 });
  await checkLockdowns(clientLike);
  assert.ok(active, 'not yet');
  active.ends_at = new Date(Date.now() - 1000).toISOString();
  await checkLockdowns(clientLike);
  assert.equal(active, null, 'the job ended it');

  console.log('lockdown ok');
})().catch((err) => { console.error(err); process.exit(1); });

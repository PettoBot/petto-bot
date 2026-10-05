// Checks what the dashboard can do with giveaways: start (with every check), end now and draw again.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const started = []; const ended = []; const rerolled = [];
const rows = new Map([[1, { id: 1, guild_id: '10', ended: false }], [2, { id: 2, guild_id: '10', ended: true }], [3, { id: 3, guild_id: '99', ended: false }]]);
stub('src/config.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/giveaways.js', { getGiveaway: async (id) => rows.get(id) ?? null });
stub('src/db/giveawayPresets.js', { getPreset: async (g, name) => (name === 'boosters' ? { id: 5 } : null) });
stub('src/db/giveawayConfig.js', { ensureConfig: async () => ({ entry_mode: 'button', reaction: '🎉', embed_template: 'default-design' }) });
stub('src/db/embedTemplates.js', { getTemplate: async (g, name) => (name === 'fancy' ? { name } : null) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/utils/giveawayEngine.js', {
  startGiveaway: async (args) => { started.push(args); return { id: 77, message_id: '555' }; },
  endGiveaway: async (client, giveaway) => { ended.push(giveaway.id); },
  rerollGiveaway: async (client, giveaway, count) => { rerolled.push([giveaway.id, count]); if (count === 9) { const e = new Error('Not enough entries.'); e.userFacing = true; throw e; } return ['1', '2']; },
});
const { runGiveawayAction } = require('../src/utils/giveawayApi');

const channel = { id: '20', type: ChannelType.GuildText, permissionsFor: () => ({ has: (flags) => flags.every((flag) => [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks].includes(flag)) }) };
const blocked = { id: '21', type: ChannelType.GuildText, permissionsFor: () => ({ has: () => false }) };
const voice = { id: '22', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) };
const guild = { id: '10', members: { me: {} }, channels: { cache: new Map([['20', channel], ['21', blocked], ['22', voice]]) } };
const client = { guilds: { cache: new Map([['10', guild]]) } };
const base = { prize: ' A nitro ', winners: 2, duration: '3d 4h', channel_id: '20', host_id: '293504726505357312' };

(async () => {
  let result = await runGiveawayAction(client, '10', 'start', base);
  assert.deepEqual(result, { ok: true, id: 77, message_id: '555', channel_id: '20' });
  const call = started[0];
  assert.equal(call.prize, 'A nitro'); assert.equal(call.winnersCount, 2); assert.equal(call.hostId, '293504726505357312');
  assert.ok(Math.abs(call.endsAt.getTime() - (Date.now() + (3 * 24 + 4) * 3600_000)) < 5000, 'the duration is read in words');
  assert.equal(call.entryMode, 'button'); assert.equal(call.embedTemplate, 'default-design', 'the server default design');

  result = await runGiveawayAction(client, '10', 'start', { ...base, preset: 'boosters', embed_template: 'fancy', entry_mode: 'reaction', claim_time: '5m' });
  assert.equal(result.ok, true); assert.equal(started[1].presetId, 5); assert.equal(started[1].embedTemplate, 'fancy'); assert.equal(started[1].entryMode, 'reaction'); assert.equal(started[1].claimTimeMs, 300000);

  for (const [patch, error] of [
    [{ prize: '  ' }, 'invalid_prize'], [{ winners: 0 }, 'invalid_winners'], [{ winners: 51 }, 'invalid_winners'], [{ winners: 1.5 }, 'invalid_winners'],
    [{ duration: 'soon' }, 'invalid_duration'], [{ claim_time: 'x' }, 'invalid_claim_time'], [{ host_id: 'me' }, 'invalid_host'],
    [{ channel_id: '404' }, 'invalid_channel'], [{ channel_id: '22' }, 'invalid_channel'], [{ channel_id: '21' }, 'missing_permissions'],
    [{ preset: 'nothing' }, 'unknown_preset'], [{ embed_template: 'nothing' }, 'unknown_design'],
  ]) {
    result = await runGiveawayAction(client, '10', 'start', { ...base, ...patch });
    assert.equal(result.ok, false, error); assert.equal(result.error, error); assert.equal(result.status, 400);
  }
  assert.equal(started.length, 2, 'nothing starts when a check fails');
  assert.equal((await runGiveawayAction(client, '404', 'start', base)).status, 404);

  assert.deepEqual(await runGiveawayAction(client, '10', 'end', { id: 1 }), { ok: true }); assert.deepEqual(ended, [1]);
  assert.equal((await runGiveawayAction(client, '10', 'end', { id: 2 })).error, 'already_ended');
  assert.equal((await runGiveawayAction(client, '10', 'end', { id: 3 })).error, 'not_found', 'a giveaway of another server');
  assert.equal((await runGiveawayAction(client, '10', 'end', { id: 'x' })).error, 'not_found');

  assert.deepEqual(await runGiveawayAction(client, '10', 'reroll', { id: 2, winners: 1 }), { ok: true, winners: ['1', '2'] }); assert.deepEqual(rerolled[0], [2, 1]);
  assert.equal((await runGiveawayAction(client, '10', 'reroll', { id: 1 })).error, 'still_running');
  assert.equal((await runGiveawayAction(client, '10', 'reroll', { id: 2, winners: 0 })).error, 'invalid_winners');
  const failed = await runGiveawayAction(client, '10', 'reroll', { id: 2, winners: 9 });
  assert.equal(failed.error, 'reroll_failed'); assert.equal(failed.message, 'Not enough entries.');
  assert.equal((await runGiveawayAction(client, '10', 'dance', {})).status, 404);

  console.log('giveaway api ok');
})().catch((error) => { console.error(error); process.exit(1); });

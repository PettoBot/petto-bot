// Checks how live counters turn into channel names and when a channel is renamed, and runs the counter job against
// a fake server so a regression shows up without a bot or a database.
const assert = require('node:assert/strict');
const path = require('node:path');
const { renderName, normalizeForType, shouldRename, MIN_RENAME_GAP_MS } = require('../src/utils/counterNames');

// Names.
assert.equal(renderName({ counter_option: 'members', name_template: '{option}: {value}', prefix: '', suffix: '' }, 12), 'members: 12');
assert.equal(renderName({ counter_option: 'boosts', name_template: 'Boosts {value}!', prefix: '> ', suffix: ' <' }, 3), '> Boosts 3! <');
assert.equal(renderName({ counter_option: 'x', name_template: '', prefix: null, suffix: null }, 1), 'x: 1');
assert.equal(renderName({ counter_option: 'x', name_template: 'a'.repeat(150), prefix: '', suffix: '' }, 1).length, 100);
assert.equal(normalizeForType('Members: 12', 'text'), 'members:-12');
assert.equal(normalizeForType('Members: 12', 'announce'), 'members:-12');
assert.equal(normalizeForType('Members: 12', 'voice'), 'Members: 12');
assert.equal(normalizeForType('Members: 12', 'category'), 'Members: 12');

// Decisions. A text channel that already shows the normalized name is left alone.
const base = { wantedName: 'Members 12', channelType: 'text', now: 1_000_000 };
assert.equal(shouldRename({ ...base, currentName: 'members-12' }), false, 'a text channel with the normalized name must not be renamed');
assert.equal(shouldRename({ ...base, currentName: 'members-11' }), true);
assert.equal(shouldRename({ ...base, currentName: 'members-11', renamedAt: base.now - 60_000 }), false, 'too soon after the last rename');
assert.equal(shouldRename({ ...base, currentName: 'members-11', renamedAt: base.now - MIN_RENAME_GAP_MS - 1 }), true);
// Discord rewrote the wanted name in its own way: do not ask again for the same value.
assert.equal(shouldRename({ ...base, wantedName: 'Members: 12', currentName: 'members12', lastWanted: 'Members: 12', lastStored: 'members12', renamedAt: base.now - MIN_RENAME_GAP_MS - 1 }), false);
// Somebody renamed it by hand: it is fixed again.
assert.equal(shouldRename({ ...base, wantedName: 'Members: 12', currentName: 'my-own-name', lastWanted: 'Members: 12', lastStored: 'members12', renamedAt: base.now - MIN_RENAME_GAP_MS - 1 }), true);

// The job, with the database, the logger and the config replaced.
function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let rows = [];
const updates = [];
const removed = [];
const warnings = [];
stub('src/db/counters.js', { listAll: async () => rows, remove: async (guildId, channelId) => { removed.push(channelId); } });
stub('src/db/database.js', { from: () => ({ update: (patch) => ({ eq: () => { updates.push(patch); return Promise.resolve({}); } }) }) });
stub('src/utils/logger.js', { info() {}, error(...args) { warnings.push(args.join(' ')); }, warn(...args) { warnings.push(args.join(' ')); } });
stub('src/config.js', { jobConcurrency: 2 });
const { updateCounters } = require('../src/jobs/counterJob');

function channel(id, name, type) {
  const calls = [];
  return { id, name, type, calls, async setName(next) { calls.push(next); this.name = type === 0 ? next.toLowerCase().replace(/[^a-z0-9_-]/g, '') : next; return this; } };
}
function makeGuild({ memberCount, cachedMembers, fetchAdds }) {
  const members = new Map(cachedMembers.map((m, i) => [String(i), m]));
  const channels = new Map();
  const guild = {
    id: '1', memberCount, premiumSubscriptionCount: 4,
    channels: { cache: Object.assign(channels, { filter(fn) { return [...channels.values()].filter(fn); } }) },
    members: {
      cache: Object.assign(members, { filter(fn) { const found = [...members.values()].filter(fn); return { size: found.length }; } }),
      fetchCalls: 0,
      async fetch() { this.fetchCalls += 1; fetchAdds.forEach((m, i) => members.set(`f${i}`, m)); return members; },
    },
  };
  return guild;
}

(async () => {
  const humans = Array.from({ length: 3 }, () => ({ user: { bot: false } }));
  const bots = Array.from({ length: 2 }, () => ({ user: { bot: true } }));
  const guild = makeGuild({ memberCount: 5, cachedMembers: [humans[0]], fetchAdds: [...humans.slice(1), ...bots] });
  const voice = channel('10', 'old', 2);
  const text = channel('11', 'old', 0);
  const bot = channel('12', 'old', 2);
  for (const c of [voice, text, bot]) guild.channels.cache.set(c.id, c);
  rows = [
    { id: 1, guild_id: '1', channel_id: '10', counter_option: 'members', channel_type: 'voice', name_template: '{option}: {value}', prefix: '', suffix: '', enabled: true, interval_seconds: 60 },
    { id: 2, guild_id: '1', channel_id: '11', counter_option: 'boosts', channel_type: 'text', name_template: 'Boosts {value}', prefix: '', suffix: '', enabled: true, interval_seconds: 60 },
    { id: 3, guild_id: '1', channel_id: '12', counter_option: 'bots_only', channel_type: 'voice', name_template: 'Bots {value}', prefix: '', suffix: '', enabled: true, interval_seconds: 60 },
    { id: 4, guild_id: '1', channel_id: '99', counter_option: 'members', channel_type: 'voice', name_template: '', prefix: '', suffix: '', enabled: true, interval_seconds: 60 },
  ];
  const client = { guilds: { cache: new Map([['1', guild]]) } };

  await updateCounters(client);
  assert.deepEqual(voice.calls, ['members: 5']);
  assert.deepEqual(text.calls, ['Boosts 4']);
  assert.deepEqual(bot.calls, ['Bots 2'], 'bots are counted from every member, not only the cached ones');
  assert.equal(guild.members.fetchCalls, 1);
  assert.deepEqual(removed, ['99'], 'a counter whose channel is gone is removed');
  assert.equal(updates.length, 3);

  // A second pass finds nothing to rename, even though the text channel kept a different name than the one asked for.
  await updateCounters(client);
  assert.equal(voice.calls.length + text.calls.length + bot.calls.length, 3);
  assert.equal(guild.members.fetchCalls, 1, 'members are not fetched again right away');

  // A failing rename is reported and does not stop the other counters.
  const broken = channel('13', 'old', 2);
  broken.setName = async () => { throw new Error('Missing Permissions'); };
  guild.channels.cache.set(broken.id, broken);
  rows = [
    { id: 5, guild_id: '1', channel_id: '13', counter_option: 'members', channel_type: 'voice', name_template: '', prefix: '', suffix: '', enabled: true, interval_seconds: 60 },
    { id: 6, guild_id: '1', channel_id: '10', counter_option: 'members', channel_type: 'voice', name_template: '{option}: {value}', prefix: '', suffix: '', enabled: true, interval_seconds: 60 },
  ];
  guild.memberCount = 6;
  await updateCounters(client);
  assert.ok(warnings.some((line) => line.includes('Missing Permissions')), 'a failed rename must be logged');
  assert.equal(voice.calls.length, 1, 'a channel renamed a moment ago waits for the rename limit instead of queueing another rename');
  console.log('Checked the counter names, the rename rules and the counter job.');
})().catch((error) => { console.error(error); process.exit(1); });

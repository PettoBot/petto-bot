// The messages that the bot keeps in memory: a server with the log of messages keeps them for an hour (as before), the others for ten minutes, and nothing is
// swept earlier than before while it is not known which servers have the log. Everything runs against fakes: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const interest = require('../src/utils/messageInterest');

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const message = (guildId, minutesAgo, edited = null) => ({ guildId, createdTimestamp: NOW - minutesAgo * MIN, editedTimestamp: edited === null ? null : NOW - edited * MIN });
const swept = (m) => interest.sweepFilter(() => NOW)()(m);

(async () => {
  // Before the first reading nobody is swept earlier than before: an hour for everybody.
  interest.reset();
  assert.equal(interest.needsMessages('1'), true, 'unknown: every server keeps them');
  assert.equal(swept(message('1', 30)), false, 'unknown: 30 minutes old is kept');
  assert.equal(swept(message('1', 61)), true, 'unknown: after an hour it goes, as always');

  // After the reading, only the servers with the log keep them an hour.
  assert.equal(await interest.refresh(async () => ['10', '20']), 2);
  assert.equal(interest.needsMessages('10'), true);
  assert.equal(interest.needsMessages('99'), false);
  assert.equal(swept(message('10', 30)), false, 'with the log, 30 minutes old is kept');
  assert.equal(swept(message('10', 61)), true, 'with the log, after an hour it goes');
  assert.equal(swept(message('99', 5)), false, 'without the log, 5 minutes old is kept');
  assert.equal(swept(message('99', 11)), true, 'without the log, after ten minutes it goes');
  assert.equal(swept(message(null, 11)), true, 'a direct message is swept after ten minutes');
  assert.equal(swept(message('99', 30, 2)), false, 'the time counts from the last edit');
  assert.equal(interest.lifetimeFor('10'), interest.FULL_LIFETIME_MS);
  assert.equal(interest.lifetimeFor('99'), interest.SHORT_LIFETIME_MS);

  // A server that turns the log on from a command keeps its messages at once.
  interest.remember('99');
  assert.equal(interest.needsMessages('99'), true);
  assert.equal(swept(message('99', 30)), false);

  // A reading that fails keeps what was known (and says it once).
  assert.equal(await interest.refresh(async () => { throw new Error('database down'); }), -1);
  assert.equal(interest.needsMessages('10'), true, 'what was known stays');
  assert.equal(interest.needsMessages('55'), false);

  // The log entries that the database gives are read as ids (numbers or text).
  assert.equal(await interest.refresh(async () => [12345678901234567, '77']), 2);
  assert.equal(interest.needsMessages('77'), true);

  // It is wired: the sweeper of the client uses the filter, every two minutes, and the log routes `remember`.
  const fs = require('node:fs');
  const index = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  assert.match(index, /messages: \{ interval: messageInterest\.SWEEP_EVERY_SECONDS, filter: messageInterest\.sweepFilter\(\) \}/, 'the sweeper of messages uses the interest of each server');
  assert.match(index, /messageInterest\.start\(\)/, 'the reading starts');
  assert.equal(interest.SWEEP_EVERY_SECONDS, 120);
  const logConfig = fs.readFileSync(require.resolve('../src/db/logConfig.js'), 'utf8');
  assert.match(logConfig, /remember\(guildId\)/, 'turning the log of messages on is remembered at once');

  // And the real thing: a client with that sweeper drops the old messages of a server without the log and keeps the others.
  const { Client, GatewayIntentBits, Options } = require('discord.js');
  interest.reset();
  await interest.refresh(async () => ['100000000000000001']);
  const client = new Client({ intents: [GatewayIntentBits.Guilds], makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 100 }), sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 0, filter: interest.sweepFilter() } } });
  for (const gid of ['100000000000000001', '100000000000000002']) {
    client.guilds._add({ id: gid, name: gid, owner_id: '1', member_count: 1, members: [], presences: [], channels: [{ id: String(BigInt(gid) + 10n), type: 0, name: 'c', position: 0, permission_overwrites: [] }], roles: [{ id: gid, name: '@everyone', permissions: '0', position: 0 }], emojis: [], stickers: [], threads: [], voice_states: [], large: false, unavailable: false, features: [] });
    const channel = client.channels.cache.get(String(BigInt(gid) + 10n));
    [5, 30, 90].forEach((minutes, i) => channel.messages._add({ id: String(((BigInt(Date.now() - minutes * MIN) - 1420070400000n) << 22n) + BigInt(i)), channel_id: channel.id, guild_id: gid, author: { id: '5', username: 'u', discriminator: '0', avatar: null }, content: `m${minutes}`, timestamp: new Date(Date.now() - minutes * MIN).toISOString(), edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], reactions: [], pinned: false, type: 0, flags: 0, components: [] }));
  }
  // A message's id carries the moment it was made (that is where `createdTimestamp` comes from), so the ids are made from the time.
  const count = (gid) => client.channels.cache.get(String(BigInt(gid) + 10n)).messages.cache.map((m) => m.content).sort().join(',');
  assert.equal(count('100000000000000001'), 'm30,m5,m90'.split(',').sort().join(','), 'before the sweep all are there');
  const removed = client.sweepers.sweepMessages(interest.sweepFilter()());
  assert.ok(removed >= 3, 'the 30 and 90 minute old of the server without the log, and the 90 minute old of the one with it were swept');
  assert.equal(count('100000000000000001'), 'm30,m5', 'the server with the log keeps what is under an hour');
  assert.equal(count('100000000000000002'), 'm5', 'the server without the log keeps what is under ten minutes');
  client.destroy();
  interest.reset();
  console.log('Message memory checks passed (an hour with the log of messages, ten minutes without, never less than before while unknown).');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

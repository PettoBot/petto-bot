// The log of a server only works for what that server turned on: an event that nobody reads is not built, and Discord is not asked who did it (the audit log
// request of `fetchMod` / `fetchEntry`). Against a fake server and a fake audit log: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { AuditLogEvent, Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let configs = {}; // guildId -> entries, or 'fail'
let reads = 0;
stub('src/db/logConfig.js', {
  EVENTS: {},
  getLogConfig: async (guildId) => { reads += 1; const entries = configs[guildId]; if (entries === 'fail') throw new Error('database down'); return { entries: (entries ?? []).map((event) => ({ event, channel_id: 'c1' })), webhooks: [], ignored: [] }; },
  deleteWebhookById: async () => {}, removeEntries: async () => {},
});
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/db/postgres.js', { createPostgresClient() {}, getPrimaryPool() {} });
stub('src/db/guilds.js', { findGuildLanguage: async () => null, listGuildLanguages: async () => [] });

const engine = require('../src/logging/engine');
const { handleVoiceState } = require('../src/logging/voiceLog');
const { handleMessageDelete, handleMessageUpdate, handleMessageBulkDelete } = require('../src/logging/messageLog');

let auditRequests = 0;
const guildOf = (id) => ({ id, fetchAuditLogs: async () => { auditRequests += 1; return { entries: new Collection() }; } });
const posts = [];
const client = { user: { id: 'bot', username: 'Petto', displayAvatarURL: () => 'x' }, guilds: { cache: new Collection() }, rest: { post: async (route, options) => { posts.push({ route, options }); } } };

(async () => {
  // logsEvent
  configs = { A: ['voice', 'members'], B: [], C: 'fail' };
  assert.equal(await engine.logsEvent('A', 'voice'), true);
  assert.equal(await engine.logsEvent('A', 'messages'), false, 'only the events that are routed');
  assert.equal(await engine.logsEvent('B', 'voice'), false, 'a server with no log at all');
  assert.equal(await engine.logsEvent('C', 'voice'), true, 'when the configuration cannot be read it says yes, as before');

  // fetchMod / fetchEntry: with the event they ask Discord only when that log is on
  auditRequests = 0;
  assert.equal(await engine.fetchMod(guildOf('B'), AuditLogEvent.MemberUpdate, '1', { event: 'voice' }), null);
  assert.equal(await engine.fetchEntry(guildOf('B'), AuditLogEvent.MemberKick, '1', { event: 'members' }), null);
  assert.equal(auditRequests, 0, 'a server without logs: no audit log request');
  await engine.fetchMod(guildOf('A'), AuditLogEvent.MemberUpdate, '1', { event: 'messages' });
  assert.equal(auditRequests, 0, 'a server whose log of that event is off: none either');
  await engine.fetchMod(guildOf('A'), AuditLogEvent.MemberUpdate, '1', { event: 'voice' });
  await engine.fetchEntry(guildOf('A'), AuditLogEvent.MemberKick, '1', { event: 'members' });
  assert.equal(auditRequests, 2, 'the log is on: it asks, as always');
  await engine.fetchMod(guildOf('C'), AuditLogEvent.MemberUpdate, '1', { event: 'voice' });
  assert.equal(auditRequests, 3, 'an unreadable configuration asks, as before');
  await engine.fetchMod(guildOf('B'), AuditLogEvent.MemberUpdate, '1');
  await engine.fetchEntry(guildOf('B'), AuditLogEvent.MemberKick, '1');
  assert.equal(auditRequests, 5, 'without `event` (the tickets use it for their own work) it always asks');

  // the voice log: a server without it builds nothing and asks nothing; with it, it logs
  const member = { id: '9', user: { id: '9', bot: false, displayAvatarURL: () => 'x' } };
  const leave = (guildId) => [{ member, channelId: '10', guild: guildOf(guildId) }, { member, channelId: null, guild: guildOf(guildId) }];
  auditRequests = 0; posts.length = 0;
  await handleVoiceState(...leave('B'), client);
  assert.equal(auditRequests, 0, 'voice, a server without the log: no audit log request');
  assert.equal(posts.length, 0, 'and nothing is posted');
  configs.A = ['voice'];
  await handleVoiceState(...leave('A'), client);
  assert.equal(auditRequests, 1, 'voice, the log is on: the audit log is asked (who disconnected them)');

  // the message log: delete, edit and bulk delete are not built for a server without it
  const author = { id: '5', bot: false, username: 'u', displayAvatarURL: () => 'x' };
  const channel = (guildId) => ({ id: '20', guild: { id: guildId } });
  const deleted = (guildId) => ({ id: '30', guild: { id: guildId }, author, content: 'hello', attachments: new Collection(), embeds: [], stickers: new Collection(), channel: channel(guildId) });
  posts.length = 0; reads = 0;
  await handleMessageDelete(deleted('B'), client);
  await handleMessageUpdate({ ...deleted('B'), partial: false, content: 'a' }, { ...deleted('B'), content: 'b', partial: false }, client);
  await handleMessageBulkDelete(new Collection([['1', deleted('B')]]), channel('B'), client);
  assert.equal(posts.length, 0, 'messages, a server without the log: nothing is built or posted');
  assert.equal(reads, 3, 'each one only looked at the configuration');
  configs.A = ['messages'];
  assert.equal(await engine.logsEvent('A', 'messages'), true);

  // wired: every call of the log files names its event, and the cache of the configuration is a few seconds longer
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', 'src', 'logging');
  let calls = 0;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js') && name !== 'engine.js')) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (/\b(fetchMod|fetchEntry)\(/.test(line) && !/^\s*(async )?function/.test(line)) { calls += 1; assert.match(line, /\{ event: '\w+' \}/, `${file}: ${line.trim()} names the event of its log`); }
    }
  }
  assert.ok(calls >= 30, `${calls} audit log lookups of the log files were checked`);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'logConfig.js'), 'utf8'), /CONFIG_CACHE_TTL_MS = 15_000/);
  console.log(`Log gate checks passed (${calls} audit log lookups name their log; a server without the log is not asked about, and nothing is built for it).`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

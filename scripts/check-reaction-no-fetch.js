// A reaction or a deleted message must not cost a request to Discord for nothing. Every reaction of every server used to be completed from Discord by up to five handlers (and the removal of a
// reaction by the snipe as well), and every deleted message that was not cached was asked for although it was gone: hundreds of `GET /channels/:id/messages/:id` per minute, which hit the
// rate limit of that route and held every other request of the bot. The handlers only use what the event brings (the ids and the emoji); the custom command that watches reactions asks
// its database by id first and completes the message only when it is watched. Discord, the database and the code commands are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// 1. The handlers that do not need anything from Discord do not ask for it.
for (const file of ['messageReactionAddRoles', 'messageReactionRemoveRoles', 'messageReactionAddGiveaway', 'messageReactionRemoveGiveaway', 'messageReactionAddActivityStats', 'messageReactionRemoveSnipe', 'messageDeleteSnipe']) {
  const source = read(`src/events/${file}.js`);
  assert.ok(!/\b(?:reaction|message|user)\.fetch\(/.test(source.replace(/\/\/.*$/gm, '')), `${file} makes no request to Discord to complete what the event brings`);
}
const messageLog = read('src/logging/messageLog.js');
const deleteHandler = messageLog.slice(messageLog.indexOf('async function handleMessageDelete'), messageLog.indexOf('async function handleMessageUpdate'));
assert.ok(!/hydrateMessage\(|\bmessage\.fetch\(/.test(deleteHandler.replace(/\/\/.*$/gm, '')), 'a deleted message is not asked for: it is gone');

// 2. The custom command that watches reactions: the database first, the message only when it is watched.
function stub(relative, exports) {
  const resolved = require.resolve(path.join(root, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let watchedRow = null;
const lookups = [];
stub('src/db/commandData.js', { forGuild: (guildId) => ({ watched: async (messageId) => { lookups.push([guildId, messageId]); return watchedRow; } }) });
stub('src/db/customCommands.js', { getCommand: async () => null });
stub('src/utils/codeCommands.js', { runReaction: async () => {}, matchEmoji: () => null });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
const handler = require('../src/events/messageReactionAddCustomCommands');

let fetches = 0;
const reaction = (id) => ({
  partial: true,
  emoji: { toString: () => '👍' },
  fetch: async () => { fetches += 1; return reaction; },
  message: { id, guildId: 'g1', partial: true, createdTimestamp: Date.now() - 3_600_000, fetch: async () => { fetches += 1; }, guild: null, client: { user: { id: 'bot' } } },
});

(async () => {
  watchedRow = null; // nobody watches this message
  await handler.execute(reaction('m1'), { bot: false });
  await handler.execute(reaction('m1'), { bot: false });
  assert.equal(fetches, 0, 'a message nobody watches is never completed from Discord');
  assert.equal(lookups.length, 1, 'and the second reaction on it does not even read the database (it is remembered for a minute)');
  assert.deepEqual(lookups[0], ['g1', 'm1'], 'the database is asked by the guild and the message id that the event brings');

  watchedRow = { emojis: ['👍'], command: 'poll' };
  await handler.execute(reaction('m2'), { bot: false });
  assert.equal(fetches, 2, 'a watched message is completed once (the reaction and the message)');

  fetches = 0;
  await handler.execute(reaction('m3'), { bot: true });
  assert.equal(fetches + lookups.filter((entry) => entry[1] === 'm3').length, 0, 'a bot reacting costs nothing');

  
// 3. An edited message that was not cached is not asked for: there is no "before" to show, and each ask was a request for nothing.
{
  const updateHandler = messageLog.slice(messageLog.indexOf('async function handleMessageUpdate'), messageLog.indexOf('async function handleMessageBulkDelete'));
  assert.ok(!/hydrateMessage\(oldMessage\)/.test(updateHandler.replace(/\/\/.*$/gm, '')), 'the edit log does not ask for the old message');
  assert.ok(/oldMessage\.partial\) return/.test(updateHandler), 'the edit log leaves an edit without a known before');
  const snipeUpdate = require('../src/events/messageUpdateSnipe');
  let asked = 0;
  const partial = () => ({ partial: true, guild: { id: '1' }, fetch: async () => { asked += 1; } });
  await snipeUpdate.execute(partial(), partial());
  assert.equal(asked, 0, 'the snipe of edits does not ask Discord for a message it never had');
}

console.log('Checked the reactions and the deleted messages: nothing is asked of Discord for what the event brings, and the custom command asks its database by id first.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

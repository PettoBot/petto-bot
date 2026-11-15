// Checks `purge all_channels`: the whole server is scanned, the channels without permissions are left out, and nothing is deleted until the member confirms.
const assert = require('node:assert/strict');
const { PermissionFlagsBits, Collection } = require('discord.js');
const purge = require('../src/commands/moderation/purge');
const { purgePrefixArgs } = require('../src/utils/purgeFilters');

assert.equal(purgePrefixArgs('everywhere 50 bots'), '--all_channels 50 --filter bots');
assert.equal(purgePrefixArgs('server contains free nitro'), '--all_channels --text "free nitro"');
assert.equal(purgePrefixArgs('everywhere'), 'everywhere', 'alone it stays as it was written');

const names = (payload) => JSON.stringify(payload);

function channel(id, { count, allowed = true, recent = true, archived = false }) {
  const deleted = [];
  const messages = Array.from({ length: count }, (_, i) => ({
    id: String(1000000000000000000n + BigInt(id.charCodeAt(0) * 1000 + i)),
    pinned: false, content: 'x', author: { id: 'u', bot: false }, attachments: new Map(), embeds: [], mentions: { everyone: false, users: new Map(), roles: new Map() },
    createdTimestamp: recent ? Date.now() - 1000 : Date.now() - 40 * 24 * 3600 * 1000,
    delete: async () => { deleted.push('one'); },
  }));
  return {
    id, deleted, archived,
    isTextBased: () => true, isThread: () => false, isDMBased: () => false,
    permissionsFor: () => ({ has: (flag) => allowed || flag === PermissionFlagsBits.ViewChannel }),
    messages: { fetch: async ({ limit }) => new Collection(messages.slice(0, limit).map((m) => [m.id, m])) },
    bulkDelete: async (chunk) => { deleted.push(...chunk); return new Collection(chunk.map((m) => [m.id, m])); },
  };
}

function run({ answer, channels, threads = [], slowThreads = false }) {
  const replies = [];
  const interaction = {
    user: { id: 'mod' }, member: { id: 'mod' }, client: {}, channel: channels[0],
    guild: { id: 'g1', preferredLocale: 'en-US', members: { me: { id: 'me' } }, channels: {
        cache: new Map(channels.map((c) => [c.id, c])),
        // The open threads (and the posts of forums) are not in the list of channels: Discord is asked for them.
        fetchActiveThreads: async () => { if (slowThreads) await new Promise((resolve) => setTimeout(resolve, 2600)); return { threads: new Map(threads.map((c) => [c.id, c])) }; },
      } },
    options: {
      getInteger: () => 5, getUser: () => null, getString: (name) => (name === 'filter' ? 'all' : null),
      getBoolean: (name) => name === 'all_channels',
    },
    deferReply: async () => {}, reply: async (payload) => { replies.push(payload); },
    editReply: async (payload) => {
      replies.push(payload);
      return { awaitMessageComponent: async () => { if (!answer) throw new Error('timeout'); return { customId: answer, user: { id: 'mod' }, update: async (next) => { replies.push(next); } }; } };
    },
  };
  return purge.execute(interaction).then(() => replies);
}

(async () => {
  const mk = () => [channel('a', { count: 3 }), channel('b', { count: 2 }), channel('c', { count: 4, allowed: false })];

  // Confirmed: the two channels where both can delete are purged, the third one is left out and counted.
  let channels = mk();
  let replies = await run({ answer: 'purge_confirm', channels });
  assert.equal(channels[0].deleted.length, 3);
  assert.equal(channels[1].deleted.length, 2);
  assert.equal(channels[2].deleted.length, 0, 'a channel without permissions is never touched');
  const result = names(replies.at(-1));
  assert.match(result, /Deleted 5 messages/);
  assert.match(result, /Channels left out/);
  assert.match(names(replies[0]), /This would delete 5 messages in the server/, 'it asked before deleting');
  assert.match(names(replies[0]), /purge_confirm/);

  // The open threads and the posts of forums are scanned too (they are threads); an archived one is left alone, and so is a thread where the member cannot delete.
  const withThreads = [channel('a', { count: 2 })];
  const posts = [channel('f', { count: 3 }), channel('g', { count: 1 }), channel('h', { count: 5, archived: true }), channel('i', { count: 4, allowed: false })];
  const threadRun = await run({ answer: 'purge_confirm', channels: withThreads, threads: posts });
  assert.equal(withThreads[0].deleted.length, 2);
  assert.equal(posts[0].deleted.length, 3, 'a forum post (a thread) is purged');
  assert.equal(posts[1].deleted.length, 1, 'so is a thread');
  assert.equal(posts[2].deleted.length, 0, 'an archived thread is not touched');
  assert.equal(posts[3].deleted.length, 0, 'a thread without permission is not touched');
  assert.match(names(threadRun[0]), /This would delete 6 messages/, 'the question counts the threads');
  assert.match(names(threadRun.at(-1)), /Deleted 6 messages/);
  assert.match(names(threadRun[0]), new RegExp(`<#f>|\\\\<#f>|#f`), 'and lists them by channel');
  // Discord taking too long to list the threads does not stop the purge of the channels.
  const slowRun = await run({ answer: 'purge_confirm', channels: [channel('a', { count: 1 })], threads: [channel('t', { count: 1 })], slowThreads: true });
  assert.match(names(slowRun.at(-1)), /Deleted 1 message/, 'only the channel: the threads were not ready in time');

  // Cancelled and no answer: nothing is deleted.
  channels = mk();
  replies = await run({ answer: 'purge_cancel', channels });
  assert.equal(channels.reduce((n, c) => n + c.deleted.length, 0), 0, 'cancel deletes nothing');
  assert.match(names(replies.at(-1)), /Cancelled/);
  channels = mk();
  replies = await run({ answer: null, channels });
  assert.equal(channels.reduce((n, c) => n + c.deleted.length, 0), 0, 'no answer deletes nothing');
  assert.match(names(replies.at(-1)), /No answer in a minute/);

  // No channel where both can delete: it says so.
  replies = await run({ answer: 'purge_confirm', channels: [channel('c', { count: 1, allowed: false })] });
  assert.match(names(replies[0]), /no text channel where you and I both have the permissions/);

  console.log('purge all channels ok');
})().catch((error) => { console.error(error); process.exit(1); });

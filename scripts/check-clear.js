// `clear 1000`: Discord gives 100 messages at a time, so the command asks for pages of 100 and deletes in groups of 100.
const assert = require('node:assert/strict');
const { collectMessages, deleteMessages } = require('../src/utils/clearMessages');

const NOW = Date.UTC(2026, 9, 10, 12);
// 350 messages, newest first, one every minute; every 3rd is from user "b"; the last 50 are older than 14 days.
const all = Array.from({ length: 350 }, (_, i) => ({
  id: String(10_000 - i), author: { id: i % 3 === 0 ? 'b' : 'a' },
  createdTimestamp: i < 300 ? NOW - i * 60_000 : NOW - 15 * 86_400_000 - i * 60_000,
}));
const asCollection = (items) => ({ size: items.length, last: () => items.at(-1), first: () => items[0], values: () => items.values() });
const asked = [];
const channel = {
  messages: {
    fetch: async ({ limit, before }) => {
      asked.push(limit);
      assert.ok(limit <= 100, 'Discord does not give more than 100 at a time');
      const start = before ? all.findIndex((m) => m.id === before) + 1 : 0;
      return asCollection(all.slice(start, start + limit));
    },
  },
  bulkDelete: async (group) => { assert.ok(group.length >= 2 && group.length <= 100, 'groups of 2 to 100'); return { size: group.length }; },
};

(async () => {
  let picked = await collectMessages(channel, { amount: 1000, now: NOW });
  assert.equal(picked.length, 300, 'it stops at the messages older than 14 days');
  assert.ok(asked.every((limit) => limit === 100));
  picked = await collectMessages(channel, { amount: 250, now: NOW });
  assert.equal(picked.length, 250);
  assert.equal(picked[0].id, '10000', 'newest first');
  picked = await collectMessages(channel, { amount: 30, userId: 'b', now: NOW });
  assert.equal(picked.length, 30); assert.ok(picked.every((m) => m.author.id === 'b'));
  assert.equal((await collectMessages(channel, { amount: 5000, now: NOW })).length, 300, 'the amount is capped');
  assert.equal(await deleteMessages(channel, await collectMessages(channel, { amount: 250, now: NOW })), 250, 'deleted in groups');
  assert.equal(await deleteMessages(channel, []), 0);
  console.log('Checked clear: pages of 100, the 14 days limit and groups of 100.');
})();

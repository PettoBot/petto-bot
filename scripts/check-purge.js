// Checks which messages `purge` selects, without Discord: each filter, combined conditions, and pinned messages.
const assert = require('node:assert/strict');
const { matchesPurge, PURGE_FILTERS } = require('../src/utils/purgeFilters');

function message(extra = {}) {
  return {
    pinned: false,
    content: 'hello world',
    author: { id: 'human', bot: false },
    attachments: new Map(),
    embeds: [],
    mentions: { everyone: false, users: new Map(), roles: new Map() },
    ...extra,
  };
}

const withAttachment = (contentType, url = 'https://cdn.example.com/file') => new Map([['1', { contentType, url }]]);

assert.ok(matchesPurge(message(), {}), 'no condition matches everything');
assert.ok(PURGE_FILTERS.every((filter) => matchesPurge(message(), { filter }) || ['bots', 'links', 'invites', 'attachments', 'images', 'embeds', 'mentions'].includes(filter)));

assert.ok(matchesPurge(message({ author: { id: 'b', bot: true } }), { filter: 'bots' }));
assert.ok(!matchesPurge(message(), { filter: 'bots' }));
assert.ok(matchesPurge(message(), { filter: 'humans' }));
assert.ok(!matchesPurge(message({ author: { id: 'b', bot: true } }), { filter: 'humans' }));

assert.ok(matchesPurge(message({ content: 'look https://example.com/a' }), { filter: 'links' }));
assert.ok(matchesPurge(message({ content: 'www.example.com' }), { filter: 'links' }));
assert.ok(!matchesPurge(message({ content: 'no link here' }), { filter: 'links' }));
assert.ok(matchesPurge(message({ content: 'join discord.gg/abc123' }), { filter: 'invites' }));
assert.ok(matchesPurge(message({ content: 'https://discord.com/invite/abc' }), { filter: 'invites' }));
assert.ok(!matchesPurge(message({ content: 'https://example.com' }), { filter: 'invites' }));

assert.ok(matchesPurge(message({ attachments: withAttachment('application/pdf') }), { filter: 'attachments' }));
assert.ok(!matchesPurge(message({ attachments: withAttachment('application/pdf') }), { filter: 'images' }));
assert.ok(matchesPurge(message({ attachments: withAttachment('image/png') }), { filter: 'images' }));
assert.ok(matchesPurge(message({ attachments: withAttachment(null, 'https://x/y.JPG?size=1') }), { filter: 'images' }));
assert.ok(matchesPurge(message({ embeds: [{ type: 'rich' }] }), { filter: 'embeds' }));
assert.ok(!matchesPurge(message(), { filter: 'embeds' }));
assert.ok(matchesPurge(message({ mentions: { everyone: true, users: new Map(), roles: new Map() } }), { filter: 'mentions' }));
assert.ok(matchesPurge(message({ mentions: { everyone: false, users: new Map([['1', {}]]), roles: new Map() } }), { filter: 'mentions' }));
assert.ok(!matchesPurge(message(), { filter: 'mentions' }));

// Conditions combine: every one given has to match.
assert.ok(matchesPurge(message({ content: 'BUY now' }), { userId: 'human', text: 'buy' }), 'text is case-insensitive');
assert.ok(!matchesPurge(message({ content: 'BUY now' }), { userId: 'someone-else', text: 'buy' }));
assert.ok(!matchesPurge(message({ content: 'hello' }), { userId: 'human', text: 'buy' }));
assert.ok(!matchesPurge(message({ content: 'https://a.b' }), { userId: 'human', filter: 'bots' }));

// Pinned messages are kept.
assert.ok(!matchesPurge(message({ pinned: true }), {}));
assert.ok(matchesPurge(message({ pinned: true }), { includePinned: true }), 'only used to count what was kept');

// An unknown filter falls back to "all" instead of deleting nothing silently.
assert.ok(matchesPurge(message(), { filter: 'nonsense' }));

console.log('Checked the purge filters.');

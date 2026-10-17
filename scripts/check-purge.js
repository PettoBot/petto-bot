// Checks which messages `purge` selects, without Discord: each filter, combined conditions, and pinned messages.
const assert = require('node:assert/strict');
const { matchesPurge, PURGE_FILTERS, messageIdOf, purgePrefixArgs } = require('../src/utils/purgeFilters');

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
assert.ok(PURGE_FILTERS.every((filter) => matchesPurge(message(), { filter }) || ['bots', 'links', 'invites', 'attachments', 'images', 'embeds', 'mentions', 'webhooks', 'stickers', 'emojis', 'reactions'].includes(filter)));

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

// The filters added after: webhooks, stickers, emojis (custom and Unicode) and reactions.
assert.ok(matchesPurge(message({ webhookId: '1' }), { filter: 'webhooks' }));
assert.ok(!matchesPurge(message(), { filter: 'webhooks' }));
assert.ok(matchesPurge(message({ stickers: new Map([['1', {}]]) }), { filter: 'stickers' }));
assert.ok(!matchesPurge(message({ stickers: new Map() }), { filter: 'stickers' }));
assert.ok(matchesPurge(message({ content: 'hi <:pet:123456789012345678>' }), { filter: 'emojis' }));
assert.ok(matchesPurge(message({ content: 'nice 😀' }), { filter: 'emojis' }));
assert.ok(!matchesPurge(message({ content: 'plain words 123' }), { filter: 'emojis' }), 'digits alone are not emojis');
assert.ok(matchesPurge(message({ reactions: { cache: new Map([['x', {}]]) } }), { filter: 'reactions' }));
assert.ok(!matchesPurge(message({ reactions: { cache: new Map() } }), { filter: 'reactions' }));

// Starts with, ends with (any case) and the range of message ids.
assert.ok(matchesPurge(message({ content: '!rank please' }), { startsWith: '!RANK' }));
assert.ok(!matchesPurge(message({ content: 'say !rank' }), { startsWith: '!rank' }));
assert.ok(matchesPurge(message({ content: 'buy now LOL  ' }), { endsWith: 'lol' }));
assert.ok(!matchesPurge(message({ content: 'lol buy now' }), { endsWith: 'lol' }));
const idMessage = message({ id: '200000000000000000' });
assert.ok(matchesPurge(idMessage, { afterId: '100000000000000000', beforeId: '300000000000000000' }), 'between two messages');
assert.ok(!matchesPurge(idMessage, { afterId: '200000000000000000' }), 'the start message itself is kept');
assert.ok(!matchesPurge(idMessage, { beforeId: '200000000000000000' }));
assert.equal(messageIdOf('https://discord.com/channels/1/2/123456789012345678'), '123456789012345678');
assert.equal(messageIdOf('123456789012345678'), '123456789012345678');
assert.equal(messageIdOf('not a message'), null);

// The short ways of writing it become the usual form.
assert.equal(purgePrefixArgs('bots 50'), '--filter bots 50');
assert.equal(purgePrefixArgs('files'), '--filter attachments');
assert.equal(purgePrefixArgs('emotes 20'), '--filter emojis 20');
assert.equal(purgePrefixArgs('contains free nitro'), '--text "free nitro"');
assert.equal(purgePrefixArgs('startswith !'), '--starts_with "!"');
assert.equal(purgePrefixArgs('endswith "lol"'), '--ends_with "lol"');
assert.equal(purgePrefixArgs('upto https://discord.com/channels/1/2/123456789012345678'), '--after https://discord.com/channels/1/2/123456789012345678');
assert.equal(purgePrefixArgs('before 123456789012345678 30'), '--before 123456789012345678 30');
assert.equal(purgePrefixArgs('between 123456789012345679 123456789012345600'), '--after 123456789012345599 --before 123456789012345680', 'both ends are included, in any order');
assert.equal(purgePrefixArgs('<@123456789012345678> 20'), '20 <@123456789012345678>');
assert.equal(purgePrefixArgs('<@123456789012345678> 20 bots'), '20 <@123456789012345678> --filter bots');
assert.equal(purgePrefixArgs('50 bots'), '50 --filter bots');
assert.equal(purgePrefixArgs('50'), '50');
assert.equal(purgePrefixArgs('50 @pancake links free nitro'), '50 @pancake --filter links --text "free nitro"', 'amount, member, kind and the words left');
assert.equal(purgePrefixArgs('20 spam and eggs'), '20 --text "spam and eggs"');
assert.equal(purgePrefixArgs('20 --filter bots'), '20 --filter bots', 'flags written by hand are left alone');
assert.equal(purgePrefixArgs(''), '');

console.log('Checked the purge filters.');

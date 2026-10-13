// {imgcard:name}: the token is read from any text of a message, taken out of it, and asks for that card.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { pullImgCards, removeImgCardTokens } = require('../src/utils/imgCardTokens');

// Nothing to take out: the same object comes back.
const plain = { content: 'hello', embeds: [{ title: 'Hi' }] };
assert.equal(pullImgCards(plain).data, plain);
assert.equal(pullImgCards(plain).card, null);

// In the text of the message.
let out = pullImgCards({ content: 'Welcome {user}!\n{imgcard:Welcome Card}', embeds: [] });
assert.equal(out.data.content, 'Welcome {user}!');
assert.deepEqual(out.card, { name: 'welcome_card', placement: 'default' });

// In an embed, with the placement, and the first one wins.
out = pullImgCards({ embeds: [{ title: 'T {imgcard:a|attachment}', description: '{imgcard:b} text' }] });
assert.equal(out.data.embeds[0].title, 'T');
assert.equal(out.data.embeds[0].description, 'text');
assert.deepEqual(out.card, { name: 'a', placement: 'attachment' });

// Inside a Components V2 design.
out = pullImgCards({ v2: { components: [{ type: 10, content: 'Hi {imgcard:rank|embed}' }] } });
assert.equal(out.data.v2.components[0].content, 'Hi');
assert.equal(out.card.name, 'rank');

// A bad name is not a token and stays as text.
assert.equal(pullImgCards({ content: '{imgcard:}' }).card, null);
assert.equal(removeImgCardTokens('a {imgcard:x} b'), 'a  b');
console.log('imgcard token ok');

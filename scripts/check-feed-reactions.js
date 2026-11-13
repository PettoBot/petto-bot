// Reactions of a feed (src/feeds/reactions.ts): reading the emojis a person wrote, keeping them clean, and adding them to a message.
const assert = require('node:assert/strict');
const { MAX_REACTIONS, addReactions, cleanReactions, customIdOf, parseReactions } = require('../src/feeds/reactions');

const CUSTOM = '<:pe_ok:123456789012345678>';
const ANIMATED = '<a:dance:223456789012345678>';

// Reading: the usual emojis, custom ones, flags, keycaps, skin tones and joined emojis, in the order they were written.
assert.equal(MAX_REACTIONS, 5);
assert.deepEqual(parseReactions('👍 🔥').emojis, ['👍', '🔥']);
assert.deepEqual(parseReactions('👍🔥❤️').emojis, ['👍', '🔥', '❤️'], 'no spaces needed');
assert.deepEqual(parseReactions(`👍, ${CUSTOM};${ANIMATED}`).emojis, ['👍', CUSTOM, ANIMATED], 'commas, semicolons and custom emojis (also animated)');
assert.deepEqual(parseReactions('🇨🇴 1️⃣ 👍🏽 👨‍👩‍👧').emojis, ['🇨🇴', '1️⃣', '👍🏽', '👨‍👩‍👧'], 'a flag, a keycap, a skin tone and a joined family are one emoji each');
assert.deepEqual(parseReactions('👍 👍 🔥 👍').emojis, ['👍', '🔥'], 'no repeats');
assert.equal(parseReactions('👍 🔥').ignored, false);
assert.equal(parseReactions('👍 yes 🔥').ignored, true, 'words between emojis are left out and reported');
assert.deepEqual(parseReactions('👍 yes 🔥').emojis, ['👍', '🔥']);
assert.deepEqual(parseReactions('hello 12 abc').emojis, [], 'letters and digits are not emojis');
assert.deepEqual(parseReactions('').emojis, []);
assert.deepEqual(parseReactions(null).emojis, []);
const six = parseReactions('1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣');
assert.equal(six.emojis.length, 5); assert.equal(six.tooMany, true, 'six is too many, the first five are kept');
assert.equal(parseReactions('1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣').tooMany, false, 'five is the limit');

// The id of a custom emoji.
assert.equal(customIdOf(CUSTOM), '123456789012345678');
assert.equal(customIdOf(ANIMATED), '223456789012345678');
assert.equal(customIdOf('👍'), null);

// What a feed keeps: only emojis, one each, no repeats, five at most.
assert.deepEqual(cleanReactions(['👍', CUSTOM, 'hello', '👍👍', '👍', 5, null, '', '<:x:1>']), ['👍', CUSTOM], 'words, two emojis in one, repeats, numbers and a broken custom emoji are dropped');
assert.deepEqual(cleanReactions(['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣']).length, 5);
assert.deepEqual(cleanReactions('👍'), [], 'a list is needed');
assert.deepEqual(cleanReactions(undefined), []);

// Adding them to a message: in order, one after the other.
(async () => {
  const made = (failures = {}) => {
    const calls = [];
    return { calls, react: async (emoji) => { calls.push(emoji); if (failures[emoji]) throw Object.assign(new Error('no'), { code: failures[emoji] }); } };
  };
  let message = made();
  assert.deepEqual(await addReactions(message, ['👍', '🔥', CUSTOM]), { added: 3, stoppedBy: null });
  assert.deepEqual(message.calls, ['👍', '🔥', CUSTOM], 'in the order they were chosen');

  // An emoji Petto cannot use (deleted, or from a server Petto left) is skipped and the others still go on.
  message = made({ [CUSTOM]: 10014 });
  assert.deepEqual(await addReactions(message, ['👍', CUSTOM, '🔥']), { added: 2, stoppedBy: null });
  assert.deepEqual(message.calls, ['👍', CUSTOM, '🔥']);

  // No permission, a message that is gone or too many reactions stop the rest, and say why. It never throws.
  message = made({ '🔥': 50013 });
  assert.deepEqual(await addReactions(message, ['👍', '🔥', '❤️']), { added: 1, stoppedBy: 50013 });
  assert.deepEqual(message.calls, ['👍', '🔥'], 'the rest is not tried');
  message = made({ '👍': 30010 });
  assert.deepEqual(await addReactions(message, ['👍', '🔥']), { added: 0, stoppedBy: 30010 });
  message = { react: async () => { throw new Error('network'); } };
  assert.deepEqual(await addReactions(message, ['👍']), { added: 0, stoppedBy: -1 }, 'an error with no code still stops and does not throw');

  // Nothing to add, or rubbish in the list.
  message = made();
  assert.deepEqual(await addReactions(message, []), { added: 0, stoppedBy: null });
  assert.deepEqual(await addReactions(message, undefined), { added: 0, stoppedBy: null });
  assert.deepEqual(await addReactions(message, ['not an emoji']), { added: 0, stoppedBy: null });
  assert.equal(message.calls.length, 0);

  console.log('check-feed-reactions: ok');
})().catch((error) => { console.error(error); process.exit(1); });

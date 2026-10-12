// Checks the rank: the numbers the rank card and the embed show, the embed itself, and which of the card, the embed or
// both is sent for each style, including when the card cannot be drawn. The card drawing is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let cardBuffer = Buffer.from('png');
stub('src/utils/cardService.js', { CARD_FILE_NAME: 'card.png', renderRankCard: async () => (cardBuffer ? { buffer: cardBuffer, name: 'card.png' } : null) });
const { buildLevelData } = require('../src/utils/levelData');
const { buildRankEmbed, buildRankReply, formatMinutes } = require('../src/utils/rankView');
const { totalXpForLevel } = require('../src/utils/levelCurve');

const config = { curve_a: 1, curve_b: 50, curve_c: 100, difficulty: 2.5, rounding: 50 };
const level = 5;
const into = 300;
const xp = totalXpForLevel(level, config) + into;
const data = buildLevelData({ config, userData: { xp, level, messages: 1234, vc_minutes: 95, streak: 4, best_streak: 9 }, rank: 3, total: 120 });
assert.equal(data.level, 5); assert.equal(data.xp, xp); assert.equal(data.xpCurrent, into);
assert.equal(data.xpNeeded, totalXpForLevel(6, config) - totalXpForLevel(5, config));
assert.equal(data.xpToNext, data.xpNeeded - into);
assert.equal(data.progress, Math.round((into / data.xpNeeded) * 100));
assert.deepEqual([data.rank, data.total, data.streak, data.bestStreak, data.messages, data.voiceMinutes, data.source], [3, 120, 4, 9, 1234, 95, 'text']);
const voice = buildLevelData({ config, userData: { voice_xp: 200, voice_level: 1, xp: 99999, level: 40 }, source: 'voice' });
assert.equal(voice.source, 'voice'); assert.equal(voice.level, 1, 'the voice level is the voice one'); assert.equal(voice.xp, 200);
assert.equal(buildLevelData({ config, userData: null }).progress, 0, 'a member with no data is at 0');
assert.ok(buildLevelData({ config: { ...config, max_level: 1 }, userData: { xp: 10, level: 0 } }).progress >= 0);

assert.equal(formatMinutes(0), '0m'); assert.equal(formatMinutes(45), '45m'); assert.equal(formatMinutes(60), '1h'); assert.equal(formatMinutes(95), '1h 35m');

const embed = buildRankEmbed({ data, name: 'Liam', avatarUrl: 'https://cdn.test/a.png', week: { xp: 400, position: 2 }, date: new Date('2026-10-02T12:00:00Z') }).toJSON();
assert.equal(embed.color, undefined, 'the embed has no color');
const fieldNames = embed.fields.map((field) => field.name);
assert.deepEqual(fieldNames, ['Level', 'Server Rank', 'Experience', `Progress (${data.progress}%)`, 'Streak', 'This week']);
assert.equal(embed.fields.find((field) => field.name === 'Level').value, String(data.level));
assert.equal(embed.fields.find((field) => field.name === 'Server Rank').value, '#3 out of 120');
assert.equal(embed.fields.find((field) => field.name === 'Experience').value, `${data.xpCurrent.toLocaleString('en-US')}/${data.xpNeeded.toLocaleString('en-US')} XP`);
assert.ok(embed.fields.find((field) => field.name.startsWith('Progress')).value.length > 0, 'the bar');
assert.equal(embed.fields.every((field) => !field.inline), true, 'one field under another');
assert.equal(embed.footer.text, `Total Experience: ${data.xp.toLocaleString('en-US')}`);
assert.ok(embed.timestamp, 'with the time');
assert.equal(embed.fields.find((field) => field.name === 'Streak').value, '4 days (best 9)');
assert.equal(embed.fields.find((field) => field.name === 'This week').value, '#2 · 400 XP');
assert.equal(embed.thumbnail.url, 'https://cdn.test/a.png'); assert.equal(embed.image, undefined, 'without a card the avatar is the thumbnail');
const withCard = buildRankEmbed({ data, name: 'Liam', avatarUrl: 'https://cdn.test/a.png', withCard: true }).toJSON();
assert.equal(withCard.image.url, 'attachment://card.png'); assert.equal(withCard.thumbnail, undefined, 'with a card the picture is the card');
const voiceEmbed = buildRankEmbed({ data: { ...data, source: 'voice', streak: 0 }, name: 'Liam' }).toJSON();
assert.equal(voiceEmbed.fields[0].name, 'Voice Level');
assert.equal(voiceEmbed.fields[0].value, '5');
assert.deepEqual(voiceEmbed.fields.map((field) => field.name).slice(-1), ['Time in voice'], 'no streak field with no streak');
assert.equal(voiceEmbed.fields[voiceEmbed.fields.length - 1].value, '1h 35m');
assert.equal(buildRankEmbed({ data: { ...data, rank: null, total: null }, name: 'x' }).toJSON().fields[1].value, 'Not ranked yet');

(async () => {
  const base = { ctx: {}, data, name: 'Liam', avatarUrl: 'https://cdn.test/a.png', week: null, cardName: null, source: 'messages' };
  let reply = await buildRankReply({ ...base, style: 'card' });
  assert.equal(reply.files.length, 1); assert.equal(reply.embeds, undefined, 'style card sends the card alone');
  reply = await buildRankReply({ ...base, style: 'embed' });
  assert.equal(reply.files, undefined); assert.equal(reply.embeds.length, 1, 'style embed sends the embed alone');
  reply = await buildRankReply({ ...base, style: 'both' });
  assert.equal(reply.files.length, 1); assert.equal(reply.embeds[0].toJSON().image.url, 'attachment://card.png', 'both puts the card inside the embed');
  cardBuffer = null;
  reply = await buildRankReply({ ...base, style: 'card' });
  assert.equal(reply.files, undefined); assert.equal(reply.embeds.length, 1, 'a card that cannot be drawn leaves the embed');
  reply = await buildRankReply({ ...base, style: 'both' });
  assert.equal(reply.embeds[0].toJSON().image, undefined);
  console.log('Checked the rank numbers, the embed and the card, embed or both styles.');
})().catch((error) => { console.error(error); process.exit(1); });

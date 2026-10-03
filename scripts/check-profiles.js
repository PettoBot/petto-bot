// Checks reviews and profiles: stars, averages, who can review whom, changing a review, the channel of new reviews, and the profile
// with the numbers of every module the server uses.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });

let reviewConfig = { reviews_enabled: true, review_channel_id: null };
let reviews = [];
stub('src/db/reviews.js', {
  getConfig: async () => reviewConfig,
  upsertConfig: async (guildId, changes) => { reviewConfig = { ...reviewConfig, ...changes }; return reviewConfig; },
  getReview: async (guildId, target, reviewer) => reviews.find((row) => row.target_id === target && row.reviewer_id === reviewer) ?? null,
  saveReview: async ({ targetId, reviewerId, stars, comment }) => { reviews = reviews.filter((row) => !(row.target_id === targetId && row.reviewer_id === reviewerId)); const row = { target_id: targetId, reviewer_id: reviewerId, stars, comment, updated_at: new Date().toISOString() }; reviews.push(row); return row; },
  removeReview: async (guildId, target, reviewer) => { const before = reviews.length; reviews = reviews.filter((row) => !(row.target_id === target && row.reviewer_id === reviewer)); return reviews.length < before; },
  listFor: async (guildId, target) => reviews.filter((row) => row.target_id === target).slice().reverse(),
});
let uploadConfig = null; let requestConfig = null; let partnerConfig = null;
stub('src/db/uploads.js', { getConfig: async () => uploadConfig, listLog: async () => [{ files: 3, created_at: '2026-10-02T10:00:00Z' }, { files: 1, created_at: '2026-09-02T10:00:00Z' }] });
stub('src/db/requests.js', { getConfig: async () => requestConfig, list: async (guildId, { claimedBy = null } = {}) => (claimedBy ? [{ status: 'done' }, { status: 'done' }] : [{ status: 'done' }, { status: 'open' }, { status: 'cancelled' }]) });
stub('src/db/partners.js', { getConfig: async () => partnerConfig, listLog: async () => [{ created_at: new Date().toISOString() }, { created_at: '2026-01-01T00:00:00Z' }] });

const engine = require('../src/utils/reviewEngine');
const reviewCommand = require('../src/commands/automation/review');
const profileCommand = require('../src/commands/automation/profile');
const profileConfigCommand = require('../src/commands/automation/profileconfig');

const fakeUser = (id, username, bot = false) => ({ id, username, bot, toString: () => `<@${id}>` });
const fakeGuild = (channel) => ({ id: 'g1', members: { fetch: async () => ({ joinedTimestamp: Date.parse('2026-05-01T00:00:00Z') }) }, channels: { fetch: async (id) => (id === 'reviews' ? channel : null) } });

(async () => {
  // Stars and averages.
  assert.deepEqual(engine.summarize([]), { count: 0, average: null }); assert.deepEqual(engine.summarize([{ stars: 5 }, { stars: 4 }, { stars: 4 }]), { count: 3, average: 4.3 });
  assert.equal(engine.starsText(4), '★★★★☆'); assert.equal(engine.starsText(4.3), '★★★★☆'); assert.equal(engine.starsText(0), '☆☆☆☆☆');
  for (const [input, expected] of [['5', 5], ['4/5', 4], ['3 stars', 3], ['1 star', 1], ['2 ★', 2], ['0', null], ['6', null], ['4.5', null], ['five', null], ['', null]]) assert.equal(engine.parseStars(input), expected, `stars from "${input}"`);
  assert.match(engine.problem({ reviewer: fakeUser('a', 'A'), target: fakeUser('b', 'B', true), stars: 5, comment: '' }), /bot/); assert.match(engine.problem({ reviewer: fakeUser('a', 'A'), target: fakeUser('a', 'A'), stars: 5, comment: '' }), /yourself/);
  assert.match(engine.problem({ reviewer: fakeUser('a', 'A'), target: fakeUser('b', 'B'), stars: null, comment: '' }), /whole number/); assert.match(engine.problem({ reviewer: fakeUser('a', 'A'), target: fakeUser('b', 'B'), stars: 5, comment: 'x'.repeat(301) }), /300 characters/); assert.equal(engine.problem({ reviewer: fakeUser('a', 'A'), target: fakeUser('b', 'B'), stars: 5, comment: 'ok' }), null);

  // The commands.
  const posted = [];
  const channel = { send: async (payload) => { posted.push(payload.components[0].text); } };
  const talk = async (command, sub, values = {}, who = fakeUser('a', 'Ann')) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = { guild: fakeGuild(channel), user: who, options: { getSubcommand: () => sub, getUser: pick, getString: pick, getBoolean: pick, getChannel: pick }, deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); } };
    await command.execute(interaction);
    return out.join('\n');
  };
  assert.match(await talk(reviewCommand, 'give', { user: fakeUser('b', 'Bob'), stars: '5', comment: ' Great\n  work ' }), /Review saved\. Bob has ★★★★★ 5 from 1 review\./);
  assert.equal(reviews[0].comment, 'Great work', 'the comment is tidied');
  assert.match(await talk(reviewCommand, 'give', { user: fakeUser('b', 'Bob'), stars: '3' }), /Your review was changed\. Bob has ★★★☆☆ 3 from 1 review\./); assert.equal(reviews.length, 1, 'a second review of the same member replaces the first');
  await talk(reviewCommand, 'give', { user: fakeUser('b', 'Bob'), stars: '5' }, fakeUser('c', 'Cy')); assert.equal(reviews.length, 2);
  assert.match(await talk(reviewCommand, 'give', { user: fakeUser('a', 'Ann'), stars: '5' }), /yourself/); assert.match(await talk(reviewCommand, 'give', { user: fakeUser('z', 'Bot', true), stars: '5' }), /bot/); assert.match(await talk(reviewCommand, 'give', { user: fakeUser('b', 'Bob'), stars: '9' }), /whole number/);
  const shown = await talk(reviewCommand, 'show', { user: fakeUser('b', 'Bob') }); assert.match(shown, /Reviews of Bob[\s\S]*★★★★☆ \*\*4\*\* from 2 reviews/); assert.match(shown, /<@c>/);
  assert.match(await talk(reviewCommand, 'show', { user: fakeUser('q', 'Quinn') }), /no reviews yet/);
  assert.match(await talk(reviewCommand, 'remove', { user: fakeUser('b', 'Bob') }), /removed/); assert.match(await talk(reviewCommand, 'remove', { user: fakeUser('b', 'Bob') }), /no review of Bob/);
  assert.match(await talk(profileConfigCommand, 'channel', { channel: { id: 'reviews', toString: () => '#reviews' } }, fakeUser('admin', 'Admin')), /shown in #reviews/);
  await talk(reviewCommand, 'give', { user: fakeUser('b', 'Bob'), stars: '4', comment: 'Fast' }); assert.match(posted[0], /★★★★☆ {2}<@a> reviewed <@b>\n> Fast/);
  assert.match(await talk(profileConfigCommand, 'view', {}, fakeUser('admin', 'Admin')), /Reviews: \*\*on\*\*[\s\S]*<#reviews>/);
  await talk(profileConfigCommand, 'reviews', { enabled: false }, fakeUser('admin', 'Admin')); assert.match(await talk(reviewCommand, 'give', { user: fakeUser('b', 'Bob'), stars: '4' }), /turned off/); await talk(profileConfigCommand, 'reviews', { enabled: true }, fakeUser('admin', 'Admin'));

  // The profile shows only the modules the server uses.
  let profile = await talk(profileCommand, null, { user: fakeUser('b', 'Bob') });
  assert.match(profile, /Profile of Bob[\s\S]*Joined <t:\d+:D>[\s\S]*Rating: ★★★★★ \*\*4.5\*\* from 2 reviews/); assert.doesNotMatch(profile, /Uploads|Requests|Partnerships/);
  uploadConfig = { enabled: true }; requestConfig = { enabled: true }; partnerConfig = { enabled: true };
  profile = await talk(profileCommand, null, { user: fakeUser('b', 'Bob') });
  assert.match(profile, /Uploads: \*\*2\*\* \(4 files\) · last <t:\d+:R>/); assert.match(profile, /Requests: \*\*3\*\* made, \*\*1\*\* done · \*\*2\*\* finished for others/); assert.match(profile, /Partnerships: \*\*2\*\* \(1 this week\)/);
  reviewConfig.reviews_enabled = false; assert.doesNotMatch(await talk(profileCommand, null, { user: fakeUser('b', 'Bob') }), /Rating/, 'the rating is hidden when reviews are off'); reviewConfig.reviews_enabled = true;
  assert.match(await talk(profileCommand, null, { user: fakeUser('nobody', 'Nobody') }), /Rating: no reviews yet/);
  for (const command of [reviewCommand, profileCommand, profileConfigCommand]) assert.equal(command.prefixOnly, true);
  assert.equal(String(profileConfigCommand.data.default_member_permissions), String(1n << 5n));
  void Collection;
  console.log('Checked the reviews and profiles: stars, who can review, changing a review, the channel and the profile.');
})().catch((error) => { console.error(error); process.exit(1); });

// Checks two things: `!steal` also takes the emojis of the message it replies to (its text, its embeds and its reactions), and
// the badges of `!userinfo` have their icons.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, PermissionFlagsBits, UserFlagsBitField } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const steal = require('../src/commands/utility/steal');
const { badgeList, badgeText, BADGE_EMOJI } = require('../src/utils/userBadges');

const created = [];
function run({ emoji = null, content = '', replied = null }) {
  const sent = [];
  const guild = {
    members: { me: { permissions: { has: (flag) => flag === PermissionFlagsBits.ManageGuildExpressions } } },
    emojis: { create: async ({ attachment, name }) => { if (name === 'broken') throw new Error('Maximum emojis reached'); created.push({ attachment, name }); return { name, toString: () => `<:${name}:1>` }; } },
    stickers: { create: async () => ({ name: 'sticker' }) },
  };
  const rawMessage = { content, stickers: new Collection(), reference: replied ? { messageId: '9' } : null, fetchReference: async () => replied };
  const interaction = {
    guild, rawMessage, options: { getString: () => emoji },
    reply: async () => {}, deferReply: async () => {}, editReply: async (payload) => sent.push(JSON.stringify(payload.components.map((c) => c.toJSON()))),
  };
  return steal.execute(interaction).then(() => sent[0]);
}
const reaction = (id, name, animated = false) => ({ emoji: { id, name, animated } });
const repliedMessage = (extra = {}) => ({ content: '', embeds: [], stickers: new Collection(), reactions: { cache: new Collection() }, ...extra });

(async () => {
  // Typed emojis come first, as before.
  let out = await run({ emoji: '<:wave:111> <a:dance:222>' });
  assert.deepEqual(created.map((entry) => entry.name), ['wave', 'dance']);
  assert.ok(created[1].attachment.endsWith('222.gif?size=512'), 'an animated emoji is a gif');

  // Reply to a message: its text, its embeds and its reactions.
  created.length = 0;
  const reactions = new Collection([['a', reaction('333', 'heart')], ['b', reaction('444', 'party', true)], ['c', { emoji: { id: null, name: '🎉' } }]]);
  out = await run({ replied: repliedMessage({ content: 'nice <:wave:111> and <:wave:111> again', embeds: [{ description: 'look <:star:555>' , fields: [{ name: 'x', value: '<a:spin:666>' }] }], reactions: { cache: reactions } }) });
  assert.deepEqual(created.map((entry) => entry.name), ['wave', 'star', 'spin', 'heart', 'party'], 'the text, the embed, its fields and the reactions, with no repeats, and not the normal emoji');
  assert.match(out, /Steal — 5 emoji\(s\)/);
  // The emojis typed win over the replied message.
  created.length = 0;
  await run({ emoji: '<:mine:777>', replied: repliedMessage({ content: '<:other:888>' }) });
  assert.deepEqual(created.map((entry) => entry.name), ['mine']);
  // Nothing to take.
  assert.match(await run({ replied: repliedMessage({ content: 'no emojis here', reactions: { cache: new Collection([['x', { emoji: { id: null, name: '🎉' } }]]) } }) }), /reply to a message that has custom emojis/);
  assert.match(await run({}), /Write a custom emoji/);
  // A failing one is told, the rest are added.
  created.length = 0;
  out = await run({ emoji: '<:broken:1> <:fine:2>' });
  assert.match(out, /broken.*failed \(Maximum emojis reached\)/); assert.deepEqual(created.map((entry) => entry.name), ['fine']);
  // At most 20 at a time.
  created.length = 0;
  out = await run({ emoji: Array.from({ length: 25 }, (_, n) => `<:e${n}:${1000 + n}>`).join(' ') });
  assert.equal(created.length, 20); assert.match(out, /Only the first 20 were taken/);

  // The badges: only the icon when there is one, the name when there is not.
  const flags = (names) => new UserFlagsBitField(names);
  const text = (user, member) => badgeText(badgeList(user, member));
  assert.equal(text({ flags: flags(['HypeSquadOnlineHouse1', 'ActiveDeveloper']), avatar: 'abc', banner: null }), `${BADGE_EMOJI.bravery} ${BADGE_EMOJI.activeDeveloper}`, 'only the icons');
  assert.equal(text({ flags: flags(['HypeSquadOnlineHouse2']), avatar: null }), BADGE_EMOJI.brilliance);
  assert.equal(text({ flags: flags(['HypeSquadOnlineHouse3']), avatar: null }), BADGE_EMOJI.balance);
  assert.equal(text({ flags: flags(['VerifiedBot']), avatar: 'x', bot: true }), BADGE_EMOJI.verifiedApp, 'a verified app is its icon, with no label');
  const iconic = { Staff: 'staff', Partner: 'partner', BugHunterLevel1: 'bugHunter1', BugHunterLevel2: 'bugHunter2', PremiumEarlySupporter: 'earlySupporter', CertifiedModerator: 'moderatorAlumni', ActiveDeveloper: 'activeDeveloper', BotHTTPInteractions: 'supportsCommands' };
  for (const [flag, key] of Object.entries(iconic)) assert.equal(text({ flags: flags([flag]), avatar: 'x' }), BADGE_EMOJI[key], `${flag} is its icon`);
  // The ones with no icon yet show their name, after the icons.
  assert.equal(text({ flags: flags(['Hypesquad', 'VerifiedDeveloper', 'Staff']), avatar: 'x' }), `${BADGE_EMOJI.staff}  HypeSquad Events · Early Verified Bot Developer`);
  // Nitro: a person with an animated avatar or a banner. An app can have both without Nitro, so it is not shown for apps.
  assert.equal(text({ flags: flags([]), avatar: 'a_1234' }), BADGE_EMOJI.nitro, 'an animated avatar only comes with Nitro for a person');
  assert.equal(text({ flags: flags([]), avatar: 'x', banner: 'b' }), BADGE_EMOJI.nitro, 'so does a banner');
  assert.equal(text({ flags: flags(['VerifiedBot']), avatar: 'a_1234', banner: 'b', bot: true }), BADGE_EMOJI.verifiedApp, 'an app with an animated avatar and a banner is not shown with Nitro');
  assert.equal(text({ flags: flags([]), avatar: 'a_1', bot: true }), '', 'nor an unverified one');
  assert.equal(text({ flags: flags([]), avatar: 'x' }, { premiumSinceTimestamp: 1700000000000 }), BADGE_EMOJI.booster);
  assert.equal(text({ flags: flags([]), avatar: 'x' }, { premiumSinceTimestamp: null }), '', 'no badge, nothing shown');
  assert.equal(text({ avatar: null }), '', 'a user with no flags');
  assert.equal(text({ flags: flags(['HypeSquadOnlineHouse1']), avatar: 'a_9' }, { premiumSinceTimestamp: 1 }), `${BADGE_EMOJI.bravery} ${BADGE_EMOJI.nitro} ${BADGE_EMOJI.booster}`, 'all together, in a row');
  for (const emoji of Object.values(BADGE_EMOJI)) assert.match(emoji, /^<a?:\w+:\d{17,20}>$/);

  console.log('steal and badges ok');
})().catch((error) => { console.error(error); process.exit(1); });

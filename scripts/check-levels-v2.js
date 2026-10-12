// Checks the second round of the levels: multipliers (roles, channels, categories, the base one and the cap), who can earn XP,
// reward roles of the voice levels, and the level-up message (it answers the message, deletes itself, can skip the ping and has
// milestones). The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
let multipliers = [];
let rewards = [];
stub('src/db/levelUsers.js', { getUser: async () => ({ xp: 500, voice_xp: 300 }), getRank: async () => 2, getVoiceRank: async () => 1 });
stub('src/db/levelRewards.js', { listRewards: async (guildId, source = 'text') => rewards.filter((r) => source === 'all' || r.source === source) });
stub('src/db/levelMultipliers.js', { listMultipliers: async () => multipliers });
stub('src/db/xpEvents.js', { listEvents: async () => [] });
stub('src/db/levelPeriods.js', { addPeriodXp: async () => {} });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/utils/embedBuilder.js', { build: async () => ({}) });
stub('src/utils/embedVariables.js', { resolve: async (text, ctx) => text.replace('{user}', `<@${ctx.member.id}>`).replace('{level}', String(ctx.levelData.level)).replace('{level_role}', ctx.levelReward ? `<@&${ctx.levelReward.id}>` : '') });
stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), applyReactReplies: async () => {} });
stub('src/utils/cardService.js', { renderRankCard: async () => null, CARD_FILE_NAME: 'card.png' });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const sent = [];
stub('src/utils/senderIdentity.js', { sendAs: async (channel, feature, payload) => { const message = { id: `m${sent.length}`, payload, deleted: false, delete: async () => { message.deleted = true; } }; sent.push({ channel: channel.id, feature, message }); return message; } });
const { getMultiplier, canEarnXp, checkRewards, notifyLevelUp, milestoneFor } = require('../src/utils/levelActions');

const roles = (...ids) => ({ roles: { cache: { has: (id) => ids.includes(id) } } });
const row = (target_id, target_type, multiplier) => ({ target_id, target_type, multiplier });

(async () => {
  // Multipliers.
  assert.equal(await getMultiplier('g', 'c1', roles()), 1, 'nothing configured');
  assert.equal(await getMultiplier('g', 'c1', roles(), { xp_multiplier: 1.5 }), 1.5, 'the base multiplier of the server');
  multipliers = [row('r1', 'role', 2), row('r2', 'role', 3), row('c1', 'channel', 2), row('cat', 'category', 4), row('r3', 'role', 0.5)];
  assert.equal(await getMultiplier('g', 'c9', roles('r1')), 2, 'a role');
  assert.equal(await getMultiplier('g', 'c9', roles('r1', 'r2')), 3, 'several roles: the highest');
  assert.equal(await getMultiplier('g', 'c9', roles('r1', 'r2'), { multiplier_mode: 'stack' }), 6, 'stacked');
  assert.equal(await getMultiplier('g', 'c9', roles('r1', 'r2'), { multiplier_mode: 'sum' }), 4, 'each extra added to 1');
  assert.equal(await getMultiplier('g', 'c9', roles('r3')), 0.5, 'a role can also lower it');
  assert.equal(await getMultiplier('g', { id: 'c1', parentId: 'cat' }, roles()), 2, 'the channel wins over its category');
  assert.equal(await getMultiplier('g', { id: 'c2', parentId: 'cat' }, roles()), 4, 'a channel with none of its own follows its category');
  assert.equal(await getMultiplier('g', { id: 'c1', parentId: 'cat' }, roles('r1', 'r2'), { multiplier_mode: 'stack', xp_multiplier: 2 }), 20, 'the cap of the server (20 by default)');
  assert.equal(await getMultiplier('g', { id: 'c1' }, roles('r1', 'r2'), { multiplier_mode: 'stack', multiplier_cap: 5 }), 5, 'a cap of its own');

  // Who can earn XP.
  const channel = { id: 'c1', parentId: 'cat', isThread: () => false };
  assert.equal(canEarnXp({ member: roles(), channel, config: {} }), true);
  assert.equal(canEarnXp({ member: roles('bad'), channel, config: { no_xp_role_ids: ['bad'] } }), false, 'a role left out');
  assert.equal(canEarnXp({ member: roles('vip'), channel, config: { only_xp_role_ids: ['vip'] } }), true, 'a role that is allowed');
  assert.equal(canEarnXp({ member: roles('other'), channel, config: { only_xp_role_ids: ['vip'] } }), false, 'only the picked roles');
  assert.equal(canEarnXp({ member: roles(), channel, config: { ignored_channel_ids: ['c1'] } }), false, 'an ignored channel');
  assert.equal(canEarnXp({ member: roles(), channel, config: { ignored_category_ids: ['cat'] } }), false, 'an ignored category');
  assert.equal(canEarnXp({ member: roles(), channel: { id: 'x', parentId: null, isThread: () => false }, config: { ignored_category_ids: ['cat'] } }), true);

  // Reward roles: each kind of level has its own.
  rewards = [{ level: 5, role_id: 'text5', source: 'text' }, { level: 5, role_id: 'voice5', source: 'voice' }];
  const given = [];
  const roleCache = new Map(['text5', 'voice5'].map((id) => [id, { id, name: id, position: 1 }]));
  const guild = { id: 'g', members: { me: { roles: { highest: { position: 10 } } } }, roles: { cache: roleCache }, channels: { fetch: async () => null } };
  const holder = { id: 'u1', roles: { cache: { has: () => false }, add: async (role) => { given.push(role.id); }, remove: async () => {} } };
  let earned = await checkRewards(guild, holder, 5, { role_mode: 'all' }, 'voice');
  assert.deepEqual([given, earned.id], [['voice5'], 'voice5'], 'a voice level gives the voice reward, not the message one');
  earned = await checkRewards(guild, holder, 5, { role_mode: 'all' }, 'text');
  assert.equal(earned.id, 'text5');
  assert.equal(await checkRewards(guild, holder, 4, { role_mode: 'all' }, 'text'), null, 'nothing earned yet');

  // The level-up message.
  const target = { id: 'chan', guild, send: async () => null };
  const message = { id: 'msg', channelId: 'chan', channel: target };
  const user = { id: 'u1', send: async (payload) => { sent.push({ dm: true, payload }); return null; }, user: { id: 'u1' } };
  const base = { notify_mode: 'reply', notify_message: '{user} reached **{level}**', notify_every: 1, max_level: 100 };
  await notifyLevelUp({ guild, member: user, config: base, level: 3, channel: target, message });
  let last = sent.at(-1);
  assert.equal(last.channel, 'chan');
  assert.deepEqual(last.message.payload.reply, { messageReference: 'msg', failIfNotExists: false }, 'it answers the message that levelled the member up');
  assert.equal(last.message.payload.content, '<@u1> reached **3**');
  assert.equal(last.message.payload.allowedMentions.repliedUser, false, 'the reply itself does not ping');
  await notifyLevelUp({ guild, member: user, config: { ...base, notify_reply: false, notify_ping: false }, level: 3, channel: target, message });
  last = sent.at(-1);
  assert.equal(last.message.payload.reply, undefined, 'replies can be turned off');
  assert.deepEqual(last.message.payload.allowedMentions, { parse: [], repliedUser: false }, 'and so can the ping');
  await notifyLevelUp({ guild, member: user, config: { ...base, notify_delete_after: 1 }, level: 3, channel: target, message });
  last = sent.at(-1);
  assert.equal(last.message.deleted, false);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(last.message.deleted, true, 'it deletes itself after the time the server chose');
  const before = sent.length;
  await notifyLevelUp({ guild, member: user, config: { ...base, notify_every: 5 }, level: 3, channel: target, message });
  assert.equal(sent.length, before, 'every 5 levels: level 3 is not announced');
  await notifyLevelUp({ guild, member: user, config: { ...base, notify_every: 5, notify_milestones: [{ level: 3, message: 'Level 3! You got {level_role}' }] }, level: 3, channel: target, message, earnedRole: { id: 'r9', name: 'Nine' } });
  assert.equal(sent.at(-1).message.payload.content, 'Level 3! You got <@&r9>', 'a level with a message of its own is always announced, with the role it gave');
  assert.equal(milestoneFor({ notify_milestones: [{ level: 10, message: 'x' }] }, 10), 'x');
  assert.equal(milestoneFor({ notify_milestones: [] }, 10), null);
  await notifyLevelUp({ guild, member: user, config: { ...base, notify_mode: 'dm' }, level: 3, channel: target, message });
  assert.equal(sent.at(-1).dm, true, 'a DM is never a reply');
  console.log('Checked the levels: multipliers, who earns XP, voice reward roles and the level-up message.');
})().catch((error) => { console.error(error); process.exit(1); });

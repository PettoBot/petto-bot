// Checks what partners, uploads, reviews and requests gained together: the milestone rewards (the engine and the `reward` commands), the nickname
// of the Partner Managers, the rules of reviews, the unified member card, the reminders and the release of requests, the defaults (everything
// off) and the migrations in schema.sql. A real Discord and a real database are not used: every piece is a fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn(m) { if (process.env.DEBUGCHECK) console.log('WARN', m); }, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/db/premium.js', { PREMIUM_LIMITS: {}, getGuildPremium: async () => ({ active: false }), getGuildLimits: () => ({ partnerChannels: 6, uploadChannels: 20 }) });

// The defaults of every new setting, from the real modules: all off.
const realDefaults = {
  partners: require('../src/db/partners').DEFAULTS,
  reviews: require('../src/db/reviews').DEFAULTS,
  requests: require('../src/db/requests').DEFAULTS,
};
assert.equal(realDefaults.partners.nickname_format, null, 'the nickname format is off by default');
assert.deepEqual([realDefaults.reviews.min_account_days, realDefaults.reviews.min_member_days, realDefaults.reviews.cooldown_minutes, realDefaults.reviews.min_comment, realDefaults.reviews.max_comment], [0, 0, 0, 0, 300], 'the review rules are off by default');
assert.equal(realDefaults.requests.reminder_hours, 0, 'the reminder is off by default'); assert.equal(realDefaults.requests.completion_hours, 0, 'the release is off by default');

// In-memory copies of the tables.
let partnerConfig = { ...realDefaults.partners };
stub('src/db/partners.js', {
  DEFAULTS: realDefaults.partners,
  getConfig: async () => partnerConfig,
  getConfigCached: async () => partnerConfig,
  upsertConfig: async (guildId, changes) => { partnerConfig = { ...partnerConfig, ...changes }; return partnerConfig; },
  listLog: async () => [],
});
let uploadConfig = { enabled: true, channel_ids: [], uploader_role_id: null, welcome: {} };
stub('src/db/uploads.js', { DEFAULTS: { enabled: false, channel_ids: [], uploader_role_id: null, welcome: {} }, getConfig: async () => uploadConfig, upsertConfig: async (guildId, changes) => { uploadConfig = { ...uploadConfig, ...changes }; return uploadConfig; }, listLog: async () => [] });

let rewards = { partner: [], upload: [] };
const awards = new Set();
let failClaim = false;
stub('src/db/milestones.js', {
  MAX_REWARDS: 25,
  list: async (guildId, kind) => rewards[kind].slice().sort((a, b) => a.count - b.count),
  upsert: async (guildId, kind, count, roleId, message) => { rewards[kind] = rewards[kind].filter((item) => item.count !== count); rewards[kind].push({ count, role_id: roleId, message: message || null }); },
  remove: async (guildId, kind, count) => { const before = rewards[kind].length; rewards[kind] = rewards[kind].filter((item) => item.count !== count); return rewards[kind].length < before; },
  // The key of the real table is the claim: checked and added at once.
  claim: async (guildId, kind, userId, count) => { if (failClaim) throw new Error('database down'); const key = `${kind}:${userId}:${count}`; if (awards.has(key)) return false; awards.add(key); return true; },
  release: async (guildId, kind, userId, count) => { awards.delete(`${kind}:${userId}:${count}`); },
});

let reviewConfig = { ...realDefaults.reviews };
let reviewRows = [];
let lastReviewAt = null;
stub('src/db/reviews.js', {
  DEFAULTS: realDefaults.reviews,
  getConfig: async () => reviewConfig,
  upsertConfig: async (guildId, changes) => { reviewConfig = { ...reviewConfig, ...changes }; return reviewConfig; },
  getReview: async (guildId, target, reviewer) => reviewRows.find((row) => row.target_id === target && row.reviewer_id === reviewer) ?? null,
  saveReview: async ({ targetId, reviewerId, stars, comment }) => { reviewRows = reviewRows.filter((row) => !(row.target_id === targetId && row.reviewer_id === reviewerId)); reviewRows.push({ target_id: targetId, reviewer_id: reviewerId, stars, comment, updated_at: new Date().toISOString() }); },
  removeReview: async (guildId, target, reviewer) => { const before = reviewRows.length; reviewRows = reviewRows.filter((row) => !(row.target_id === target && row.reviewer_id === reviewer)); return reviewRows.length < before; },
  listFor: async (guildId, target) => reviewRows.filter((row) => row.target_id === target),
  lastBy: async () => lastReviewAt,
});

let requestConfig = { ...realDefaults.requests, enabled: true, channel_id: 'cards', staff_role_id: 'staff', guild_id: 'g1' };
let requestRows = [];
stub('src/db/requests.js', {
  DEFAULTS: realDefaults.requests,
  getConfig: async () => requestConfig,
  upsertConfig: async (guildId, changes) => { requestConfig = { ...requestConfig, ...changes }; return requestConfig; },
  listConfigsWithTimeout: async () => (requestConfig.enabled && requestConfig.completion_hours > 0 ? [requestConfig] : []),
  listConfigsWithReminder: async () => (requestConfig.enabled && requestConfig.reminder_hours > 0 ? [requestConfig] : []),
  listClaimedBefore: async (guildId, before) => requestRows.filter((row) => row.status === 'claimed' && new Date(row.claimed_at) < before),
  releaseClaim: async (guildId, number, claimedBy, before) => { const row = requestRows.find((item) => item.number === number && item.status === 'claimed' && item.claimed_by === String(claimedBy) && new Date(item.claimed_at) < before); if (!row) return null; Object.assign(row, { status: 'open', claimed_by: null, claimed_at: null }); return { ...row }; },
  listUnremindedBefore: async (guildId, before) => requestRows.filter((row) => row.status === 'open' && !row.reminded_at && new Date(row.created_at) < before),
  markReminded: async (guildId, number) => { const row = requestRows.find((item) => item.number === number && item.status === 'open' && !item.reminded_at); if (!row) return null; row.reminded_at = new Date().toISOString(); return { ...row }; },
  update: async () => null,
  list: async () => [],
});

const milestones = require('../src/utils/milestones');
const deadRoles = require('../src/utils/deadRoles');
const engine = require('../src/utils/partnerEngine');
const reviewEngine = require('../src/utils/reviewEngine');
const { applyNickname } = require('../src/utils/partnerNickname');
const { unclaimLate, remindUnclaimed, parseHours } = require('../src/utils/requestTimeouts');
const partnerConfigCommand = require('../src/commands/automation/partnerconfig');
const uploadConfigCommand = require('../src/commands/automation/uploadconfig');
const profileConfigCommand = require('../src/commands/automation/profileconfig');
const requestConfigCommand = require('../src/commands/automation/requestconfig');
const reviewCommand = require('../src/commands/automation/review');
const profileCommand = require('../src/commands/automation/profile');

const fakeUser = (id, username, extra = {}) => ({ id, username, globalName: username, displayName: username, bot: false, tag: username, createdTimestamp: Date.now() - 400 * 86_400_000, displayAvatarURL: () => 'https://cdn.example/a.png', bannerURL: () => null, toString: () => `<@${id}>`, ...extra });

/** A server with Petto in it: the roles it knows, what Petto may do and the members. */
function fakeGuild({ roles = [], manageRoles = true, highest = 10, nicknames = true } = {}) {
  const members = new Map();
  const guild = {
    id: 'g1', name: 'Mine', ownerId: 'owner', memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, channels: { cache: new Collection() }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() },
    available: true, client: {},
    roles: { cache: new Collection(roles.map((role) => [role.id, { managed: false, position: 1, name: role.id, ...role }])) },
    members: {
      cache: new Collection(),
      me: { roles: { highest: { position: highest } }, permissions: { has: (flag) => (flag === PermissionFlagsBits.ManageRoles ? manageRoles : flag === PermissionFlagsBits.ManageNicknames ? nicknames : true) } },
      fetch: async (id) => members.get(id) ?? null,
    },
    members_: members,
  };
  return guild;
}
function fakeMember(guild, id, { deadRoleIds = [], failWith = null, manageable = true } = {}) {
  const given = [];
  const member = {
    id, user: fakeUser(id, `User${id}`), given, manageable, nickname: null, nicknames: [], displayName: `User${id}`, displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1_700_000_000_000,
    roles: { cache: new Collection(), add: async (role) => { if (failWith) throw failWith; if (deadRoleIds.includes(role)) { const error = new Error('Unknown Role'); error.code = 10011; throw error; } given.push(role); member.roles.cache.set(role, { id: role }); } },
    setNickname: async (nick) => { if (failWith) throw failWith; member.nicknames.push(nick); member.nickname = nick; },
  };
  guild.members_.set(id, member);
  return member;
}
const fakeChannel = () => { const posted = []; return { posted, send: async (payload) => { posted.push(payload); return { id: 'x' }; } }; };

(async () => {
  deadRoles.resetNotes();

  // ----- Milestones: the engine.
  rewards = { partner: [{ count: 5, role_id: 'r5', message: 'GG {user.mention}, {milestone.count} reached! {milestone.role}' }, { count: 10, role_id: 'r10', message: null }], upload: [] };
  let guild = fakeGuild({ roles: [{ id: 'r5' }, { id: 'r10' }] });
  let member = fakeMember(guild, 'a');
  let channel = fakeChannel();
  const award = (over = {}) => milestones.awardMilestones({ guild, member, user: member.user, kind: 'partner', total: 4, channel, ...over });
  assert.deepEqual(await award(), [], 'below the first milestone nothing is given');
  assert.deepEqual(await award({ total: 5 }), [5]);
  assert.deepEqual(member.given, ['r5']); assert.equal(channel.posted.length, 1); assert.match(channel.posted[0].content, /GG <@a>, 5 reached! <@&r5>/); assert.deepEqual(channel.posted[0].allowedMentions, { users: ['a'] }, 'the role is shown, never pinged');
  assert.deepEqual(await award({ total: 5 }), [], 'the same milestone is not given twice'); assert.deepEqual(await award({ total: 7 }), []);
  assert.deepEqual(await award({ total: 10 }), [10]); assert.deepEqual(member.given, ['r5', 'r10']); assert.equal(channel.posted.length, 1, 'a reward without a message posts nothing');
  // A removed partnership does not take anything back: the engine only gives.
  assert.deepEqual(await award({ total: 3 }), []); assert.deepEqual(member.given, ['r5', 'r10'], 'a lower total takes no role back');

  // Two members at the same moment, and the same member twice at the same moment.
  awards.clear(); channel = fakeChannel();
  guild = fakeGuild({ roles: [{ id: 'r5' }, { id: 'r10' }] });
  const m1 = fakeMember(guild, 'm1'); const m2 = fakeMember(guild, 'm2');
  const results = await Promise.all([
    milestones.awardMilestones({ guild, member: m1, user: m1.user, kind: 'partner', total: 5, channel }),
    milestones.awardMilestones({ guild, member: m2, user: m2.user, kind: 'partner', total: 5, channel }),
    milestones.awardMilestones({ guild, member: m1, user: m1.user, kind: 'partner', total: 5, channel }),
    milestones.awardMilestones({ guild, member: m1, user: m1.user, kind: 'partner', total: 5, channel }),
  ]);
  assert.equal(results.flat().length, 2, 'two members get one each and the repeats get nothing'); assert.deepEqual(m1.given, ['r5']); assert.deepEqual(m2.given, ['r5']); assert.equal(channel.posted.length, 2);

  // A deleted role is skipped, the others are still given, and nothing throws.
  awards.clear(); rewards.partner = [{ count: 1, role_id: 'gone', message: 'never' }, { count: 2, role_id: 'r5', message: null }];
  guild = fakeGuild({ roles: [{ id: 'r5' }] }); member = fakeMember(guild, 'b'); channel = fakeChannel();
  assert.deepEqual(await milestones.awardMilestones({ guild, member, user: member.user, kind: 'partner', total: 2, channel }), [2], 'the role that is gone is skipped');
  assert.deepEqual(member.given, ['r5']); assert.equal(channel.posted.length, 0);
  // Discord says the role does not exist when it is given (the cache was old): skipped too, and the milestone is not lost for others.
  awards.clear(); rewards.partner = [{ count: 1, role_id: 'ghost', message: 'never' }, { count: 2, role_id: 'r5', message: null }];
  guild = fakeGuild({ roles: [{ id: 'ghost' }, { id: 'r5' }] }); member = fakeMember(guild, 'c', { deadRoleIds: ['ghost'] }); channel = fakeChannel();
  assert.deepEqual(await milestones.awardMilestones({ guild, member, user: member.user, kind: 'partner', total: 2, channel }), [2]); assert.deepEqual(member.given, ['r5']); assert.equal(channel.posted.length, 0, 'no message for a role that could not be given');
  // No Manage Roles, a role above Petto and a managed role: nothing is given and the milestone stays open for later.
  for (const [label, g] of [['Manage Roles', fakeGuild({ roles: [{ id: 'r5' }], manageRoles: false })], ['hierarchy', fakeGuild({ roles: [{ id: 'r5', position: 20 }], highest: 5 })], ['managed role', fakeGuild({ roles: [{ id: 'r5', managed: true }] })]]) {
    awards.clear(); rewards.partner = [{ count: 1, role_id: 'r5', message: 'hi' }];
    const m = fakeMember(g, 'd'); const c = fakeChannel();
    assert.deepEqual(await milestones.awardMilestones({ guild: g, member: m, user: m.user, kind: 'partner', total: 1, channel: c }), [], `without ${label} nothing is given`);
    assert.equal(m.given.length, 0); assert.equal(c.posted.length, 0); assert.equal(awards.size, 0, 'and it is not marked as given');
  }
  // A failure of the database never throws.
  failClaim = true; rewards.partner = [{ count: 1, role_id: 'r5', message: null }];
  guild = fakeGuild({ roles: [{ id: 'r5' }] }); member = fakeMember(guild, 'e');
  assert.deepEqual(await milestones.awardMilestones({ guild, member, user: member.user, kind: 'partner', total: 1, channel: fakeChannel() }), []); failClaim = false;
  // The member is fetched when it is not in memory; a member that is not there is skipped.
  awards.clear(); guild = fakeGuild({ roles: [{ id: 'r5' }] }); const fetched = fakeMember(guild, 'f');
  assert.deepEqual(await milestones.awardMilestones({ guild, member: null, user: fetched.user, kind: 'partner', total: 1, channel: fakeChannel() }), [1]);
  assert.deepEqual(await milestones.awardMilestones({ guild, member: null, user: fakeUser('nobody', 'Nobody'), kind: 'partner', total: 1, channel: fakeChannel() }), []);
  // Uploads have their own list.
  awards.clear(); rewards.upload = [{ count: 3, role_id: 'r10', message: 'Upload {milestone.count}' }]; guild = fakeGuild({ roles: [{ id: 'r10' }] }); member = fakeMember(guild, 'g'); channel = fakeChannel();
  assert.deepEqual(await milestones.awardMilestones({ guild, member, user: member.user, kind: 'upload', total: 3, channel }), [3]); assert.match(channel.posted[0].content, /Upload 3/);

  // ----- The `reward` commands of partners and uploads.
  const talk = async (command, sub, values = {}, over = {}) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = {
      guild: over.guild ?? fakeGuild({ roles: [{ id: 'r5' }] }), user: fakeUser('admin', 'Admin'), member: over.member ?? null, memberPermissions: over.permissions ?? null,
      options: { getSubcommand: () => sub, getString: pick, getBoolean: pick, getInteger: pick, getUser: pick, getRole: pick, getChannel: pick },
      deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); },
    };
    await command.execute(interaction);
    return out.join('\n');
  };
  const role = (id, extra = {}) => ({ id, managed: false, position: 1, toString: () => `<@&${id}>`, ...extra });
  rewards = { partner: [], upload: [] };
  for (const [command, kind] of [[partnerConfigCommand, 'partner'], [uploadConfigCommand, 'upload']]) {
    assert.match(await talk(command, 'reward', { action: 'list' }), /No .* rewards yet/);
    assert.match(await talk(command, 'reward', { action: 'add', count: 10, role: role('r5'), message: ' Well done {user.mention} ' }), /At 10 the role <@&r5> is given and the message is posted/);
    assert.deepEqual(rewards[kind], [{ count: 10, role_id: 'r5', message: 'Well done {user.mention}' }]);
    assert.match(await talk(command, 'reward', { action: 'add', count: 25, role: role('r5') }), /At 25 the role <@&r5> is given\./);
    assert.match(await talk(command, 'reward', { action: 'list' }), /\*\*10\*\* → <@&r5> · Well done[\s\S]*\*\*25\*\* → <@&r5>/);
    assert.match(await talk(command, 'reward', { action: 'add', count: 10, role: role('r5'), message: 'again' }), /At 10/); assert.equal(rewards[kind].length, 2, 'the same number replaces the reward');
    assert.match(await talk(command, 'reward', { action: 'add', role: role('r5') }), /whole number from 1 to 1000000/);
    assert.match(await talk(command, 'reward', { action: 'add', count: 0, role: role('r5') }), /whole number/);
    assert.match(await talk(command, 'reward', { action: 'add', count: 3 }), /Say the role/);
    assert.match(await talk(command, 'reward', { action: 'add', count: 3, role: role('bot', { managed: true }) }), /can not be given/);
    assert.match(await talk(command, 'reward', { action: 'add', count: 3, role: role('g1') }), /can not be given/, '@everyone is not a reward');
    assert.match(await talk(command, 'reward', { action: 'add', count: 3, role: role('high', { position: 50 }) }, { guild: fakeGuild({ roles: [], highest: 5 }) }), /I can not give <@&high>/, 'a role above Petto is refused when it is added');
    assert.match(await talk(command, 'reward', { action: 'add', count: 3, role: role('r5') }, { guild: fakeGuild({ roles: [], manageRoles: false }) }), /Manage Roles/);
    assert.match(await talk(command, 'reward', { action: 'nope' }), /Choose add, remove or list/);
    assert.match(await talk(command, 'reward', { action: 'remove', count: 25 }), /reward at 25 is removed\. Roles already given stay/); assert.match(await talk(command, 'reward', { action: 'remove', count: 25 }), /no reward at 25/);
    for (let count = 100; rewards[kind].length < 25; count += 1) rewards[kind].push({ count, role_id: 'r5', message: null });
    assert.match(await talk(command, 'reward', { action: 'add', count: 999, role: role('r5') }), /up to 25 rewards/); assert.match(await talk(command, 'reward', { action: 'add', count: 100, role: role('r5') }), /At 100/, 'a full list can still change one');
    rewards[kind] = [];
    const sub = command.data.toJSON().options.find((option) => option.name === 'reward');
    assert.deepEqual(sub.options.map((option) => option.name), ['action', 'count', 'role', 'message'], 'the order of the words with the prefix: action, count, role, message (the rest of the text)');
    assert.equal(sub.options[0].required, true); assert.ok(sub.options.slice(1).every((option) => !option.required));
    assert.equal(String(command.data.default_member_permissions), String(1n << 5n), 'only who can manage the server');
  }

  // ----- The nickname format.
  assert.equal(engine.validNicknameFormat('[{count}] {name}'), true); assert.equal(engine.validNicknameFormat('{name}'), true); assert.equal(engine.validNicknameFormat('PM'), false); assert.equal(engine.validNicknameFormat(''), false); assert.equal(engine.validNicknameFormat(`{name}${'x'.repeat(70)}`), false);
  assert.equal(engine.formatNickname('[{count}] {name}', 'Mia', 12), '[12] Mia'); assert.equal(engine.formatNickname('{name} | PM', 'A'.repeat(40), 3).length <= 32, true); assert.equal(engine.formatNickname('{name} | PM', 'A'.repeat(40), 3), `${'A'.repeat(27)} | PM`, 'the name is the part that is cut');
  assert.match(await talk(partnerConfigCommand, 'nickname', {}), /nickname format is off/);
  assert.match(await talk(partnerConfigCommand, 'nickname', { format: 'PM' }), /needs \{name\} or \{count\}/); assert.equal(partnerConfig.nickname_format, null);
  assert.match(await talk(partnerConfigCommand, 'nickname', { format: '[{count}] {name}' }), /nickname of the Partner Manager is `\[\{count\}\] \{name\}`/); assert.equal(partnerConfig.nickname_format, '[{count}] {name}');
  assert.match(await talk(partnerConfigCommand, 'nickname', { format: '[{count}] {name}' }, { guild: fakeGuild({ nicknames: false }) }), /give me Manage Nicknames/);
  assert.match(await talk(partnerConfigCommand, 'nickname', {}), /is `\[\{count\}\] \{name\}`/); assert.match(await talk(partnerConfigCommand, 'view'), /Nickname of managers: `\[\{count\}\] \{name\}`/);
  guild = fakeGuild(); member = fakeMember(guild, 'n1');
  const user = fakeUser('n1', 'Mia');
  assert.equal(await applyNickname({ guild, member, user, config: partnerConfig, total: 7 }), '[7] Mia'); assert.deepEqual(member.nicknames, ['[7] Mia']);
  assert.equal(await applyNickname({ guild, member, user, config: partnerConfig, total: 7 }), null, 'the same nickname is not set again'); assert.equal(member.nicknames.length, 1);
  assert.equal(await applyNickname({ guild, member: fakeMember(guild, 'n2', { manageable: false }), user, config: partnerConfig, total: 1 }), null, 'a member Petto can not manage is left alone');
  assert.equal(await applyNickname({ guild: fakeGuild({ nicknames: false }), member: fakeMember(fakeGuild(), 'n3'), user, config: partnerConfig, total: 1 }), null, 'without Manage Nicknames nothing is changed');
  assert.equal(await applyNickname({ guild, member: fakeMember(guild, 'n4', { failWith: new Error('Missing Permissions') }), user, config: partnerConfig, total: 1 }), null, 'a failure never throws');
  assert.equal(await applyNickname({ guild, member: fakeMember(guild, 'n5'), user, config: { ...partnerConfig, nickname_format: null }, total: 1 }), null, 'off: nothing');
  assert.match(await talk(partnerConfigCommand, 'nickname', { format: 'Off' }), /format is off/); assert.equal(partnerConfig.nickname_format, null);

  // ----- Reviews: the rules.
  const now = Date.now();
  const target = fakeUser('t', 'Tess'); const reviewer = fakeUser('r', 'Rex');
  const base = { reviewer, target, stars: 5, comment: 'Nice' };
  assert.equal(reviewEngine.problem({ ...base, config: realDefaults.reviews }), null, 'with the defaults every rule is off');
  assert.match(reviewEngine.problem({ ...base, reviewer: fakeUser('t', 'Tess') }), /yourself/, 'no self-review');
  assert.match(reviewEngine.problem({ ...base, reviewer: fakeUser('r', 'Rex', { createdTimestamp: now - 2 * 86_400_000 }), config: { ...realDefaults.reviews, min_account_days: 7 }, now }), /at least 7 days old/);
  assert.equal(reviewEngine.problem({ ...base, reviewer: fakeUser('r', 'Rex', { createdTimestamp: now - 9 * 86_400_000 }), config: { ...realDefaults.reviews, min_account_days: 7 }, now }), null);
  assert.match(reviewEngine.problem({ ...base, config: { ...realDefaults.reviews, min_member_days: 3 }, reviewerMember: { joinedTimestamp: now - 86_400_000 }, now }), /at least 3 days/);
  assert.equal(reviewEngine.problem({ ...base, config: { ...realDefaults.reviews, min_member_days: 3 }, reviewerMember: null, now }), null, 'an unknown join date does not refuse');
  assert.match(reviewEngine.problem({ ...base, config: { ...realDefaults.reviews, cooldown_minutes: 60 }, lastAt: new Date(now - 10 * 60_000).toISOString(), now }), /review again <t:\d+:R>/);
  assert.equal(reviewEngine.problem({ ...base, config: { ...realDefaults.reviews, cooldown_minutes: 60 }, lastAt: new Date(now - 90 * 60_000).toISOString(), now }), null);
  assert.match(reviewEngine.problem({ ...base, comment: 'x'.repeat(60), config: { ...realDefaults.reviews, max_comment: 50 } }), /up to 50 characters/);
  assert.match(reviewEngine.problem({ ...base, comment: 'ok', config: { ...realDefaults.reviews, min_comment: 10 } }), /at least 10 characters/);
  assert.match(reviewEngine.problem({ ...base, comment: 'x'.repeat(301), config: { ...realDefaults.reviews, max_comment: 999 } }), /up to 300/, 'the comment never goes past what the database holds');

  // The commands: setting the rules.
  assert.match(await talk(profileConfigCommand, 'rules', {}), /account of \*\*0\*\* days/);
  assert.match(await talk(profileConfigCommand, 'rules', { account_days: 7, member_days: 2, cooldown: '1h 30m', min_comment: 5, max_comment: 120 }), /Review rules saved/);
  assert.deepEqual([reviewConfig.min_account_days, reviewConfig.min_member_days, reviewConfig.cooldown_minutes, reviewConfig.min_comment, reviewConfig.max_comment], [7, 2, 90, 5, 120]);
  assert.match(await talk(profileConfigCommand, 'rules', { cooldown: 'soon' }), /time like `30m`/); assert.equal(reviewConfig.cooldown_minutes, 90, 'an invalid value changes nothing');
  assert.match(await talk(profileConfigCommand, 'rules', { min_comment: 200 }), /can not be more than the maximum/); assert.equal(reviewConfig.min_comment, 5);
  assert.match(await talk(profileConfigCommand, 'view'), /Cooldown: \*\*1h 30m\*\*/);
  await talk(profileConfigCommand, 'rules', { account_days: 0, member_days: 0, cooldown: 'none', min_comment: 0, max_comment: 300 });
  assert.deepEqual([reviewConfig.min_account_days, reviewConfig.min_member_days, reviewConfig.cooldown_minutes, reviewConfig.min_comment, reviewConfig.max_comment], [0, 0, 0, 0, 300], 'every rule can be turned off again');
  const rulesOptions = profileConfigCommand.data.toJSON().options.find((option) => option.name === 'rules').options;
  assert.ok(rulesOptions.every((option) => !option.required), 'a value left out keeps the current one');

  // The review command with the rules: refused, the stored review is untouched; a second review edits; staff can remove somebody else's.
  const review = async (sub, values, who = fakeUser('r', 'Rex'), extra = {}) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = { guild: fakeGuild(), user: who, member: { joinedTimestamp: Date.now() - 86_400_000, permissions: extra.permissions }, memberPermissions: extra.permissions ?? null, options: { getSubcommand: () => sub, getUser: pick, getString: pick }, deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components[0].text); } };
    await reviewCommand.execute(interaction);
    return out.join('\n');
  };
  reviewRows = [];
  assert.match(await review('give', { user: target, stars: '5', comment: 'Great' }), /Review saved/); assert.match(await review('give', { user: target, stars: '4' }), /Your review was changed/); assert.equal(reviewRows.length, 1, 'one review per reviewer and target: the second edits the first');
  reviewConfig = { ...reviewConfig, cooldown_minutes: 60 }; lastReviewAt = new Date().toISOString();
  assert.match(await review('give', { user: target, stars: '3' }), /review again/); assert.equal(reviewRows[0].stars, 4, 'a refused review does not change the stored one');
  lastReviewAt = null; reviewConfig = { ...reviewConfig, cooldown_minutes: 0, min_member_days: 5 };
  assert.match(await review('give', { user: target, stars: '3' }), /at least 5 days/); reviewConfig = { ...reviewConfig, min_member_days: 0 };
  assert.match(await review('give', { user: fakeUser('r', 'Rex'), stars: '3' }), /yourself/);
  assert.match(await review('show', { user: target }), /\*\*4\*\* from 1 review/, 'the average and the count are shown');
  const staffPerms = { has: (flag) => flag === PermissionFlagsBits.ManageMessages };
  assert.match(await review('remove', { user: target, reviewer: fakeUser('r', 'Rex') }, fakeUser('mod', 'Mod'), { permissions: { has: () => false } }), /Only the staff/); assert.equal(reviewRows.length, 1);
  assert.match(await review('remove', { user: target, reviewer: fakeUser('r', 'Rex') }, fakeUser('mod', 'Mod'), { permissions: staffPerms }), /removed/); assert.equal(reviewRows.length, 0, 'the staff removes a review');
  // Reviews of someone who left stay stored: nothing here looks at the target being in the server.
  await review('give', { user: fakeUser('gone', 'Gone'), stars: '5' }); assert.equal(reviewRows.some((row) => row.target_id === 'gone'), true, 'a review of a member who left is stored');
  assert.deepEqual(reviewCommand.data.toJSON().options.find((option) => option.name === 'remove').options.map((option) => option.name), ['user', 'reviewer']);

  // ----- The member card, in three languages, within the limit of a message.
  const data = {
    rating: { count: 3, average: 4.7, last: '2026-10-30T10:00:00Z' },
    partners: { total: 12, week: 3, day: 1, rank: 2, last: '2026-11-01T10:00:00Z' },
    uploads: { total: 40, files: 95, week: 5, rank: 1, last: '2026-11-01T11:00:00Z' },
    requests: { made: 4, done: 3, staffDone: 9 },
  };
  const joined = { joinedTimestamp: Date.parse('2025-01-01T00:00:00Z') };
  const longName = 'N'.repeat(32);
  const expected = {
    en: [/Profile of/, /Partnerships: \*\*12\*\* · \*\*3\*\* this week · \*\*1\*\* today · rank \*\*#2\*\* · last <t:\d+:R>/, /Uploads: \*\*40\*\* \(95 files\) · \*\*5\*\* this week · rank \*\*#1\*\*/, /from 3 reviews · last <t:\d+:R>/, /\*\*9\*\* finished for others/],
    es: [/Perfil de/, /Alianzas: \*\*12\*\* · \*\*3\*\* esta semana · \*\*1\*\* hoy · puesto \*\*#2\*\* · última <t:\d+:R>/, /Subidas: \*\*40\*\* \(95 archivos\)/],
    'pt-BR': [/Perfil de/, /Parcerias: \*\*12\*\* · \*\*3\*\* nesta semana · \*\*1\*\* hoje · posição \*\*#2\*\*/, /Envios: \*\*40\*\* \(95 arquivos\)/],
  };
  for (const lang of ['en', 'es', 'pt-BR']) {
    const text = profileCommand.profileText(fakeUser('p', longName), joined, data, lang);
    assert.ok(text.length < 4000, `${lang}: the card fits a message`);
    for (const pattern of expected[lang]) assert.match(text, pattern, `${lang}: ${pattern}`);
    assert.doesNotMatch(text, /\bp\b>|<@p>/, `${lang}: no private data or ids of the member`);
    assert.doesNotMatch(profileCommand.profileText(fakeUser('p', longName), joined, { ...data, partners: null, uploads: null }, lang), /Alianzas|Partnerships|Parcerias|Subidas|Uploads|Envios/, `${lang}: only the sections that are on`);
  }
  assert.match(profileCommand.profileText(fakeUser('p', 'Pat'), joined, { partners: { total: 0, week: 0, day: 0, rank: null, last: null }, uploads: { total: 0, files: 0 }, rating: { count: 0, average: null } }, 'en'), /Partnerships: none yet[\s\S]*Uploads: none yet/);
  assert.equal(profileCommand.profileText(fakeUser('p', 'Pat'), joined, { ...data, rating: { count: 1, average: 5, last: null }, partners: { ...data.partners, rank: null } }, 'en').includes('rank **#null'), false);
  assert.ok(profileCommand.profileText(fakeUser('p', 'x'.repeat(5000)), joined, data, 'en').length <= 3900, 'a card is always cut to fit');

  // ----- Requests: reminders and release.
  const sentNotices = [];
  const cardChannel = { send: async (payload) => { sentNotices.push(payload); return { id: 'n' }; }, messages: { fetch: async () => ({ edit: async () => {} }) } };
  const client = { channels: { fetch: async () => cardChannel } };
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const open = (number, hours, extra = {}) => ({ number, guild_id: 'g1', user_id: `u${number}`, content: 'help', status: 'open', claimed_by: null, claimed_at: null, created_at: hoursAgo(hours), reminded_at: null, channel_id: 'cards', message_id: `m${number}`, ...extra });
  requestRows = [open(1, 5), open(2, 1), open(3, 9, { status: 'claimed', claimed_by: 's1', claimed_at: hoursAgo(9) }), open(4, 30, { status: 'done' })];
  assert.equal(await remindUnclaimed(client), 0, 'off by default: no reminder');
  assert.equal(await unclaimLate(client), 0, 'off by default: nothing is released');
  requestConfig = { ...requestConfig, reminder_hours: 3 };
  assert.equal(await remindUnclaimed(client), 1, 'one old open request is reminded');
  assert.match(sentNotices[0].content, /^<@&staff> Request #1 from <@u1> has waited 3 hours with nobody to claim it\. https:\/\/discord\.com\/channels\/g1\/cards\/m1$/); assert.deepEqual(sentNotices[0].allowedMentions, { roles: ['staff'], users: [] }, 'only the staff role is pinged');
  assert.equal(await remindUnclaimed(client), 0, 'a restart or a second run does not remind again'); assert.equal(sentNotices.length, 1);
  assert.equal(requestRows[1].reminded_at, null, 'a recent request waits'); assert.equal(requestRows[3].reminded_at, null, 'a finished request is not reminded');
  // Claimed between the list and the mark: the request is left alone.
  requestRows.push(open(5, 6)); const realList = require('../src/db/requests').listUnremindedBefore;
  requestRows[requestRows.length - 1].status = 'claimed'; // taken by the staff just now: it is not open any more
  assert.equal(await remindUnclaimed(client), 0, 'a request that was claimed meanwhile is not reminded'); void realList;
  // Without a staff role the ping role is used, and without any, nobody is pinged.
  requestRows.push(open(6, 6)); requestConfig = { ...requestConfig, staff_role_id: null, ping_role_id: 'pingers' }; assert.equal(await remindUnclaimed(client), 1); assert.match(sentNotices.at(-1).content, /^<@&pingers> /);
  requestRows.push(open(7, 6)); requestConfig = { ...requestConfig, ping_role_id: null }; assert.equal(await remindUnclaimed(client), 1); assert.deepEqual(sentNotices.at(-1).allowedMentions, { roles: [], users: [] }); assert.doesNotMatch(sentNotices.at(-1).content, /<@&/);
  // A channel that does not exist or cannot be written never throws, and the request is not retried forever.
  requestRows.push(open(8, 6)); const failing = { channels: { fetch: async () => { throw new Error('boom'); } } }; assert.equal(await remindUnclaimed(failing), 0);
  // Release: one action for each request, free, and a request finished meanwhile is not reopened.
  requestConfig = { ...requestConfig, completion_hours: 6, reminder_hours: 0 };
  const before = sentNotices.length;
  assert.equal(await unclaimLate(client), 1, 'a claim older than the time goes back to open'); assert.equal(requestRows[2].status, 'open'); assert.equal(requestRows[2].claimed_by, null);
  assert.match(sentNotices[before].content, /Request #3 was claimed by <@s1> and not finished in 6 hours/);
  assert.equal(await unclaimLate(client), 0, 'the second run has nothing to release'); assert.equal(sentNotices.length, before + 1);
  requestRows.push(open(9, 12, { status: 'claimed', claimed_by: 's2', claimed_at: hoursAgo(12) })); requestRows.at(-1).status = 'done';
  assert.equal(await unclaimLate(client), 0, 'a request finished in the meantime stays finished');
  // The commands.
  assert.deepEqual([parseHours('12'), parseHours('12h'), parseHours('off'), parseHours('None'), parseHours('0'), parseHours('721'), parseHours('x'), parseHours('')], [12, 12, 0, 0, 0, null, null, null]);
  assert.match(await talk(requestConfigCommand, 'notify', { hours: '6' }), /reminded, once, of a request nobody claimed in 6 hours/); assert.equal(requestConfig.reminder_hours, 6);
  assert.match(await talk(requestConfigCommand, 'notify', { hours: 'soon' }), /from 1 to 720, or `off`/); assert.equal(requestConfig.reminder_hours, 6, 'an invalid value changes nothing');
  assert.match(await talk(requestConfigCommand, 'notify', { hours: 'off' }), /No reminders/); assert.equal(requestConfig.reminder_hours, 0);
  assert.match(await talk(requestConfigCommand, 'unclaim', { hours: '24' }), /goes back to open after 24 hours/); assert.equal(requestConfig.completion_hours, 24, 'free: no Premium needed');
  assert.match(await talk(requestConfigCommand, 'unclaim', { hours: 'off' }), /no time limit/); assert.equal(requestConfig.completion_hours, 0);
  assert.match(await talk(requestConfigCommand, 'unclaim', { hours: '999' }), /from 1 to 720/);
  assert.match(await talk(requestConfigCommand, 'view'), /Reminder for an unclaimed request: no limit/);
  assert.equal(String(requestConfigCommand.data.default_member_permissions), String(1n << 5n));

  // ----- schema.sql: idempotent, nothing destroyed.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  for (const table of ['milestone_rewards', 'milestone_awards']) {
    assert.match(schema, new RegExp(`create table if not exists ${table} \\(`), `${table} is created if it does not exist`);
    assert.match(schema, new RegExp(`alter table ${table} enable row level security;`), `${table} has row level security`);
  }
  assert.match(schema, /primary key \(guild_id, kind, user_id, count\)/, 'the award is claimed by its primary key');
  for (const column of ['partner_config add column if not exists nickname_format', 'profile_config add column if not exists min_account_days', 'profile_config add column if not exists min_member_days', 'profile_config add column if not exists cooldown_minutes', 'profile_config add column if not exists min_comment', 'profile_config add column if not exists max_comment', 'request_config add column if not exists reminder_hours', 'requests add column if not exists reminded_at']) {
    assert.ok(schema.includes(`alter table ${column}`), `${column} is idempotent`);
  }
  const block = schema.slice(schema.indexOf('-- Partners, uploads, reviews and requests, more settings:'), schema.indexOf('-- Honeypot: what is posted in the bait channel.'));
  assert.ok(block.length > 500, 'the migration block is there');
  assert.doesNotMatch(block, /\b(drop|truncate|delete from)\b/i, 'no destructive statement');
  assert.doesNotMatch(block, /create (unique )?index (?!if not exists)/i, 'indexes are created only if they do not exist');
  assert.match(block, /not null default 0/, 'new counters default to off');

  console.log('Checked the community modules: milestones, nickname, review rules, the member card, request reminders and the migrations.');
})().catch((error) => { console.error(error); process.exit(1); });

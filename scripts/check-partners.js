// Checks the partner module: finding invites, the requirements, the day/week/total numbers, the replies a server can change,
// and the whole path of a message in a partner channel, from the invite to the answer.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
const templates = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });
let premiumActive = false;
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premiumActive }), getGuildLimits: (premium) => ({ partnerChannels: premium?.active ? 25 : 6 }) });

// An in-memory copy of the partner tables.
let config = null;
const blacklist = new Set();
let logRows = [];
let nextId = 1;
stub('src/db/partners.js', {
  DEFAULTS: { enabled: false, channel_ids: [], manager_role_id: null, min_members: 0, min_age_days: 0, cooldown_days: 0, keep_original: true, react_emoji: null, messages: {} },
  getConfig: async () => config,
  getConfigCached: async () => config,
  upsertConfig: async (guildId, changes) => { config = { ...(config ?? { enabled: false, channel_ids: [], manager_role_id: null, min_members: 0, min_age_days: 0, cooldown_days: 0, keep_original: true, react_emoji: null, messages: {} }), ...changes }; return config; },
  isBlacklisted: async (guildId, partnerId) => blacklist.has(partnerId),
  listBlacklist: async () => [...blacklist].map((id) => ({ partner_guild_id: id, note: null })),
  addBlacklist: async (guildId, id) => { blacklist.add(id); },
  removeBlacklist: async (guildId, id) => blacklist.delete(id),
  lastWith: async (guildId, partnerId) => logRows.filter((row) => row.partner_guild_id === partnerId).at(-1) ?? null,
  addLog: async (row) => { const saved = { id: nextId++, guild_id: row.guildId, manager_id: row.managerId, partner_guild_id: row.partnerGuildId, partner_name: row.partnerName, members: row.members, created_at: new Date().toISOString() }; logRows.push(saved); return saved; },
  removeLog: async () => true,
  listLog: async (guildId, { since = null, managerId = null } = {}) => logRows.filter((row) => (!since || new Date(row.created_at) >= since) && (!managerId || row.manager_id === managerId)).slice().reverse(),
});

const engine = require('../src/utils/partnerEngine');
const messages = require('../src/utils/partnerMessages');
const event = require('../src/events/messageCreatePartners');

const fakeUser = (id, username, bot = false) => ({ id, username, bot, tag: username, globalName: username, displayName: username, createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.example/a.png', bannerURL: () => null, toString: () => `<@${id}>` });

const fakeGuild = (id, extra = {}) => ({ id, name: 'Mine', ownerId: 'owner', memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, members: { cache: new Collection() }, channels: { cache: new Collection() }, roles: { cache: new Collection() }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() }, ...extra });

(async () => {
  // Invites in a text.
  assert.deepEqual(engine.extractInviteCodes('join discord.gg/abc123, https://discord.com/invite/XyZ-9 and discord.gg/ABC123'), ['abc123', 'XyZ-9']);
  assert.deepEqual(engine.extractInviteCodes('no invite here, discord.gg/ alone, http://example.com/invite/abc'), []);
  assert.equal(engine.extractInviteCodes('discord.gg/a1 discord.gg/b2 discord.gg/c3 discord.gg/d4').length, 3, 'at most three');
  assert.equal(engine.snowflakeDate('1554674616033616004').toISOString().slice(0, 10), '2026-09-30');
  assert.equal(engine.snowflakeDate('nope'), null);

  // The requirements, in order.
  const rules = { min_members: 100, min_age_days: 30, cooldown_days: 7 };
  const now = Date.parse('2026-10-03T12:00:00Z');
  const good = { guildId: 'p1', name: 'Partner', members: 500, createdAt: new Date('2025-01-01') };
  const judge = (over = {}, extra = {}) => engine.judge({ invite: { ...good, ...over }, ownGuildId: 'mine', config: rules, now, ...extra });
  assert.equal(judge(), null);
  assert.equal(judge({ guildId: 'mine' }), 'self_partner');
  assert.equal(judge({}, { blacklisted: true }), 'blacklisted');
  assert.equal(judge({ members: 99 }), 'member_requirement');
  assert.equal(judge({ members: null }), 'member_requirement', 'an unknown size does not pass a requirement');
  assert.equal(judge({ createdAt: new Date('2026-09-20') }), 'age_requirement');
  assert.equal(judge({ createdAt: null }), 'age_requirement');
  assert.equal(judge({}, { last: { created_at: '2026-10-01T00:00:00Z' } }), 'cooldown');
  assert.equal(judge({}, { last: { created_at: '2026-09-20T00:00:00Z' } }), null, 'the cooldown ends');
  assert.equal(engine.judge({ invite: { ...good, members: 1, createdAt: null }, ownGuildId: 'mine', config: { min_members: 0, min_age_days: 0, cooldown_days: 0 }, now }), null, 'no requirements, no problem');

  // Periods and numbers: Saturday 2026-10-03, the week started on Monday 2026-09-28.
  const saturday = new Date('2026-10-03T20:00:00Z');
  assert.equal(engine.periodStart('day', saturday).toISOString(), '2026-10-03T00:00:00.000Z');
  assert.equal(engine.periodStart('week', saturday).toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(engine.periodStart('week', new Date('2026-09-28T01:00:00Z')).toISOString(), '2026-09-28T00:00:00.000Z', 'Monday is the first day');
  assert.equal(engine.periodStart('week', new Date('2026-10-04T23:00:00Z')).toISOString(), '2026-09-28T00:00:00.000Z', 'Sunday is the last');
  assert.equal(engine.periodStart('all'), null);
  const rows = [
    { manager_id: 'a', created_at: '2026-10-03T10:00:00Z' }, { manager_id: 'a', created_at: '2026-09-29T10:00:00Z' },
    { manager_id: 'b', created_at: '2026-09-01T10:00:00Z' }, { manager_id: 'b', created_at: '2026-09-02T10:00:00Z' }, { manager_id: 'b', created_at: '2026-09-03T10:00:00Z' },
  ];
  assert.deepEqual(engine.counts(rows.filter((row) => row.manager_id === 'a'), saturday), { day: 1, week: 2, total: 2 });
  assert.deepEqual(engine.rank(rows), [{ managerId: 'b', count: 3 }, { managerId: 'a', count: 2 }]);
  assert.deepEqual(engine.rank([{ manager_id: 'x', created_at: '2026-09-02T00:00:00Z' }, { manager_id: 'y', created_at: '2026-09-01T00:00:00Z' }]).map((entry) => entry.managerId), ['y', 'x'], 'a tie goes to who started first');

  // The replies: the default, a changed text, a missing saved embed.
  const partnerCtx = (extra = {}) => ({ user: fakeUser('7', 'Mia'), member: { id: '7', user: fakeUser('7', 'Mia'), roles: { cache: new Collection() }, displayName: 'Mia', displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1_700_000_000_000 }, guild: fakeGuild('mine'), partner: messages.partnerContext({ name: 'Partner', members: 1234, managerId: '7', counts: { day: 1, week: 2, total: 3 }, config: rules, ...extra }) });
  let payload = await messages.responsePayload('mine', { messages: {} }, 'completed', partnerCtx());
  assert.match(payload.content, /<@7> thanks for the partnership with \*\*Partner\*\*/); assert.match(payload.content, /3 in total \(2 this week\)/);
  payload = await messages.responsePayload('mine', { messages: { member_requirement: { text: 'Too small: {partner.members}/{partner.min_members}' } } }, 'member_requirement', partnerCtx());
  assert.equal(payload.content, 'Too small: 1,234/100');
  payload = await messages.responsePayload('mine', { messages: { completed: { template: 'gone' } } }, 'completed', partnerCtx());
  assert.match(payload.content, /thanks for the partnership/, 'a missing saved embed gives the default text');
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(messages.textOf({ messages: { completed: { text: '   ' } } }, 'completed'), messages.DEFAULTS.completed, 'an empty text gives the default');
  for (const key of messages.RESPONSE_KEYS) assert.ok(messages.DEFAULTS[key] && messages.LABELS[key], `${key} has a default and a name`);

  // A message in a partner channel, from the invite to the answer.
  const invites = {
    good1: { code: 'good1', memberCount: 500, guild: { id: '1100000000000000001', name: 'Good Server' } },
    small: { code: 'small', memberCount: 10, guild: { id: '1100000000000000002', name: 'Small Server' } },
    mine: { code: 'mine', memberCount: 900, guild: { id: 'guild1', name: 'Mine' } },
    bad: { code: 'bad', memberCount: 900, guild: { id: '1100000000000000003', name: 'Black Server' } },
  };
  const client = { fetchInvite: async (code) => { if (!invites[code]) throw new Error('Unknown Invite'); return invites[code]; } };
  const sent = [];
  const made = (content, { channelId = 'chan', roles = ['pm'], authorId = 'u1', bot = false } = {}) => {
    const message = {
      id: `m${sent.length + 1}`, content, client, author: fakeUser(authorId, 'Mia', bot), channel: { id: channelId },
      member: { id: authorId, user: fakeUser(authorId, 'Mia'), displayName: 'Mia', displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1_700_000_000_000, roles: { cache: new Collection(roles.map((id) => [id, { id }])) } },
      guild: fakeGuild('guild1', { members: { cache: new Collection(), me: { permissions: { has: () => true } } } }),
      reply: async (payload) => { sent.push({ kind: 'reply', content: payload.content }); },
      react: async (emoji) => { sent.push({ kind: 'react', emoji }); },
      delete: async () => { sent.push({ kind: 'delete' }); },
    };
    return message;
  };
  const run = async (content, options) => { sent.length = 0; await event.execute(made(content, options)); return [...sent]; };

  assert.deepEqual(await run('discord.gg/good1'), [], 'nothing happens while the module is off');
  config = { enabled: true, channel_ids: ['chan'], manager_role_id: 'pm', min_members: 100, min_age_days: 0, cooldown_days: 7, keep_original: true, react_emoji: '🤝', messages: {}, guild_id: 'guild1' };
  assert.deepEqual(await run('discord.gg/good1', { channelId: 'other' }), [], 'only partner channels count');
  assert.deepEqual(await run('discord.gg/good1', { roles: [] }), [], 'only Partner Managers count');
  assert.deepEqual(await run('hello there'), [], 'chatter without an invite is ignored');
  assert.deepEqual(await run('discord.gg/good1', { bot: true }), [], 'bots are ignored');

  let out = await run('our server discord.gg/good1');
  assert.equal(out.length, 2); assert.match(out[0].content, /thanks for the partnership with \*\*Good Server\*\*/); assert.match(out[0].content, /1 in total \(1 this week\)/); assert.equal(out[1].emoji, '🤝');
  assert.equal(logRows.length, 1); assert.equal(logRows[0].partner_name, 'Good Server'); assert.equal(logRows[0].members, 500);

  out = await run('discord.gg/good1');
  assert.match(out[0].content, /partnered with \*\*Good Server\*\* recently/, 'the cooldown'); assert.equal(logRows.length, 1, 'a refused one is not counted');
  out = await run('discord.gg/small'); assert.match(out[0].content, /has 10 members and at least 100/); assert.equal(logRows.length, 1);
  out = await run('discord.gg/mine'); assert.match(out[0].content, /this same server/);
  out = await run('discord.gg/unknown'); assert.match(out[0].content, /not valid or has expired/);
  blacklist.add('1100000000000000003');
  out = await run('discord.gg/bad'); assert.match(out[0].content, /not allowed as a partner/);
  assert.equal(out.some((item) => item.kind === 'delete'), false, 'the post is kept by default');

  // A refused post is deleted when the server asks for it.
  config.keep_original = false;
  out = await run('discord.gg/bad'); assert.equal(out.at(-1).kind, 'delete', 'the refused post is deleted when the server chose that');
  config.keep_original = true;

  // The commands: settings are saved, the limit of channels follows the plan, and the numbers are shown.
  const partner = require('../src/commands/automation/partner');
  const partnerConfig = require('../src/commands/automation/partnerconfig');
  const given = [];
  const talk = async (command, sub, values = {}) => {
    const replies = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = {
      guild: fakeGuild('guild1', { members: { cache: new Collection(), me: { roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetch: async (id) => ({ id, user: fakeUser(id, 'New'), displayName: 'New', displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1_700_000_000_000, roles: { cache: new Collection(), add: async (role) => given.push(role.id) } }) }, roles: { cache: new Collection([['pm', { id: 'pm', position: 1 }]]) } }),
      user: fakeUser('u1', 'Mia'), channel: { send: async (payload) => replies.push({ sent: payload.content }) },
      options: { getSubcommand: () => sub, getBoolean: pick, getString: pick, getInteger: pick, getUser: pick, getRole: pick, getChannel: pick },
      deferReply: async () => {}, editReply: async (payload) => { replies.push(payload.components[0].text); },
    };
    await command.execute(interaction);
    return replies.filter((reply) => typeof reply === 'string').join('\n');
  };
  config = null; nextId = 1; logRows = []; blacklist.clear();
  assert.match(await talk(partner, 'stats'), /not turned on/);
  assert.match(await talk(partnerConfig, 'enable', { enabled: true }), /Partners are on\. Add a channel/);
  for (let index = 1; index <= 6; index += 1) await talk(partnerConfig, 'addchannel', { channel: { id: `c${index}`, toString: () => `#c${index}` } });
  assert.equal(config.channel_ids.length, 6);
  assert.match(await talk(partnerConfig, 'addchannel', { channel: { id: 'c7', toString: () => '#c7' } }), /already has 6 partner channels\. Premium raises it to 25/);
  premiumActive = true;
  assert.match(await talk(partnerConfig, 'addchannel', { channel: { id: 'c7', toString: () => '#c7' } }), /is now a partner channel/); premiumActive = false;
  assert.match(await talk(partnerConfig, 'removechannel', { channel: { id: 'c7', toString: () => '#c7' } }), /not a partner channel anymore/);
  assert.match(await talk(partnerConfig, 'manager', { role: { id: 'pm', toString: () => '@PM' } }), /members with @PM/); assert.equal(config.manager_role_id, 'pm');
  assert.match(await talk(partnerConfig, 'requirements', { members: 250, age_days: 14, cooldown_days: 3, reaction: '🤝' }), /Requirements saved/);
  assert.deepEqual([config.min_members, config.min_age_days, config.cooldown_days, config.react_emoji], [250, 14, 3, '🤝']);
  assert.match(await talk(partnerConfig, 'requirements', { reaction: 'two words' }), /does not look like an emoji/);
  await talk(partnerConfig, 'requirements', { reaction: 'none' }); assert.equal(config.react_emoji, null);
  assert.match(await talk(partnerConfig, 'blacklist', { action: 'add', server: 'abc' }), /number of 17 to 20 digits/);
  assert.match(await talk(partnerConfig, 'blacklist', { action: 'add', server: '1100000000000000009', note: 'spam' }), /can not be a partner/);
  assert.match(await talk(partnerConfig, 'blacklist', { action: 'list' }), /1100000000000000009/);
  assert.match(await talk(partnerConfig, 'blacklist', { action: 'remove', server: '1100000000000000009' }), /not blacklisted anymore/);
  assert.match(await talk(partnerConfig, 'response', { reply: 'completed', text: 'Yay {partner.name}' }), /Partnership completed saved/); assert.equal(config.messages.completed.text, 'Yay {partner.name}');
  assert.match(await talk(partnerConfig, 'response', { reply: 'completed', template: 'nope' }), /no saved embed called `nope`/);
  templates.set('guild1:fancy', { data: { content: 'x' } });
  await talk(partnerConfig, 'response', { reply: 'cooldown', template: 'fancy' }); assert.equal(config.messages.cooldown.template, 'fancy');
  assert.match(await talk(partnerConfig, 'response', { reply: 'completed', text: 'reset' }), /goes back to the default/); assert.equal(config.messages.completed, undefined);
  assert.match(await talk(partnerConfig, 'view'), /Partners[\s\S]*250,?\s?\+? ?members|250\+ members/);
  assert.match(await talk(partnerConfig, 'welcome', { user: fakeUser('u9', 'New') }), /is a Partner Manager now/); assert.deepEqual(given, ['pm'], 'the manager role is given');
  logRows = [
    { id: 1, manager_id: 'u1', partner_name: 'One', created_at: new Date().toISOString() },
    { id: 2, manager_id: 'u1', partner_name: 'Two', created_at: new Date().toISOString() },
    { id: 3, manager_id: 'u2', partner_name: 'Three', created_at: new Date(Date.now() - 40 * 86400000).toISOString() },
  ];
  config.enabled = true;
  assert.match(await talk(partner, 'stats'), /Total: \*\*2\*\*/);
  const board = await talk(partner, 'leaderboard', { period: 'all' });
  assert.match(board, /1\. <@u1>  \*\*2\*\*[\s\S]*2\. <@u2>  \*\*1\*\*/);
  assert.match(await talk(partner, 'leaderboard', { period: 'today' }), /Today/, 'with the prefix the words are read');
  assert.match(await talk(partner, 'leaderboard', { period: 'nonsense' }), /Choose `today`/);
  assert.match(await talk(partnerConfig, 'blacklist', { action: 'nope', server: '1100000000000000009' }), /Choose `add`/);
  assert.match(await talk(partnerConfig, 'response', { reply: 'nope' }), /Choose one of/);
  assert.match(await talk(partnerConfig, 'response', { reply: 'invalid-invite' }), /Invalid invite/, 'a name with dashes is read too');
  assert.doesNotMatch(await talk(partner, 'leaderboard', { period: 'week' }), /<@u2>/, 'old ones are not in this week');

  // The commands are built the way Discord needs.
  assert.deepEqual(partner.data.toJSON().options.map((option) => option.name), ['stats', 'leaderboard']);
  assert.ok(partnerConfig.data.toJSON().options.map((option) => option.name).includes('requirements'));
  assert.equal(String(partnerConfig.data.default_member_permissions), String(1n << 5n), 'only who can manage the server');
  console.log('Checked the partners: finding the invites, the requirements, the numbers, the replies and a message from start to end.');
})().catch((error) => { console.error(error); process.exit(1); });

// Checks the quest alerts: reading the API's answer (and its ETag), the filters, the first run that only remembers, who is
// told about what, the "ending soon" alert, the card and the saved embed, who can use it, and the prefix options.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const settingsOfConfig = { ownerId: 'owner', developerIds: ['dev'], questTesterIds: ['tester'], questsPublic: false };
stub('src/config.js', settingsOfConfig);
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/quests.js', { DEFAULTS: {} });
const templates = {};
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (templates[name] ? { name, data: templates[name] } : null) });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
const questApi = require('../src/utils/questApi');
const { questMessage, buildQuestCard, questContext } = require('../src/utils/questMessages');
const { canUseQuests, matchesFilters, checkQuests } = require('../src/utils/questAlerts');
const { resolve } = require('../src/utils/embedVariables');

const day = 86_400_000;
const now = Date.now();
const iso = (offset) => new Date(now + offset).toISOString();
function rawQuest(id, { name, game = 'Some Game', publisher = 'Pub', rewardType = 4, orbs = 200, rewardName, tasks = { WATCH_VIDEO: 120 }, start = -day, end = 5 * day, color = '#4752C4' }) {
  return {
    id,
    config: {
      id, config_version: 2, starts_at: iso(start), expires_at: iso(end),
      application: { id: '1', name: game, link: 'https://example.com/game' },
      assets: { hero: `quests/${id}/111.jpg`, logotype_dark: `quests/${id}/222.png`, game_tile_dark: 'PLACEHOLDER' },
      colors: { primary: color, secondary: '#000000' },
      messages: { quest_name: name, game_title: game, game_publisher: publisher },
      task_config_v2: { tasks: Object.fromEntries(Object.entries(tasks).map(([type, target]) => [type, { type, target }])), join_operator: 'or' },
      rewards_config: { rewards: [{ type: rewardType, orb_quantity: orbs, messages: { name: rewardName ?? `${orbs} Orbs` } }], platforms: [0] },
    },
  };
}
const ids = { orbs: '1550000000000000001', deco: '1550000000000000002', play: '1550000000000000003', old: '1550000000000000004', future: '1550000000000000005' };
const api = [
  rawQuest(ids.orbs, { name: 'Watch the trailer', orbs: 200 }),
  rawQuest(ids.deco, { name: 'Decoration quest', rewardType: 3, rewardName: 'Cool Helmet Avatar Decoration', tasks: { PLAY_ON_DESKTOP: 900 } }),
  rawQuest(ids.play, { name: 'Play for Orbs', orbs: 700, tasks: { PLAY_ON_PLAYSTATION: 900 } }),
  rawQuest(ids.old, { name: 'Ended quest', start: -10 * day, end: -day }),
  rawQuest(ids.future, { name: 'Not started', start: day, end: 9 * day }),
];
const regionRows = { quests: [{ id: ids.orbs, show_age_gate: true, is_global: false, regions: { include: ['US'], exclude: [] } }] };

(async () => {
  // Reading the answer.
  const normalized = api.map((raw) => questApi.normalizeQuest(raw, raw.id === ids.orbs ? regionRows.quests[0] : null));
  const [orbs, deco, play] = normalized;
  assert.equal(orbs.name, 'Watch the trailer'); assert.equal(orbs.rewards[0].kind, 'orbs'); assert.equal(orbs.rewards[0].amount, 200);
  assert.equal(orbs.image, `https://cdn.discordapp.com/quests/${ids.orbs}/111.jpg`); assert.equal(orbs.logo, `https://cdn.discordapp.com/quests/${ids.orbs}/222.png`);
  assert.equal(orbs.ageGate, true); assert.equal(orbs.global, false); assert.deepEqual(orbs.regions.include, ['US']);
  assert.equal(deco.rewards[0].kind, 'decoration'); assert.equal(play.platforms[0], 'PlayStation'); assert.equal(play.tasks[0].kind, 'play');
  assert.equal(questApi.normalizeQuest({ id: 'x', config: {} }), null, 'a quest with no id or name is dropped');
  const evil = questApi.normalizeQuest({ id: ids.orbs, config: { ...api[0].config, application: { name: 'x', link: 'javascript:alert(1)' }, assets: { hero: 'https://evil.test/a.png' }, messages: { quest_name: 'Name\u0000\n with   spaces' } } });
  assert.equal(evil.link, null); assert.equal(evil.image, null); assert.equal(evil.name, 'Name with spaces', 'text is cleaned, links and pictures are checked');
  assert.equal(questApi.isActive(normalized[3]), false); assert.equal(questApi.isActive(normalized[4]), false); assert.equal(questApi.isActive(orbs), true);

  // The sources: both are read, joined by id, and one failing does not stop the other. ETags make the second call empty.
  const calls = [];
  const trackerRows = [...api, rawQuest('1550000000000000009', { name: 'Only in the tracker' })];
  let failTracker = false; let failCommunity = false;
  global.fetch = async (url, options = {}) => {
    const link = String(url);
    calls.push([link, options.headers?.['if-none-match'] ?? null]);
    if (link.endsWith('/api/regions')) return new Response(JSON.stringify(regionRows), { status: 200 });
    const tracker = link.includes('githubusercontent');
    if (tracker ? failTracker : failCommunity) return new Response('nope', { status: 503 });
    const etag = tracker ? '"t1"' : '"v1"';
    if (options.headers?.['if-none-match'] === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(tracker ? trackerRows : api), { status: 200, headers: { etag, 'content-length': '5000' } });
  };
  let answer = await questApi.fetchQuests();
  assert.equal(answer.notModified, false); assert.equal(answer.quests.length, 6, 'the quest only the tracker has is included');
  assert.equal(answer.quests.find((quest) => quest.id === ids.orbs).ageGate, true, 'the community API wins, it knows the limits');
  answer = await questApi.fetchQuests();
  assert.equal(answer.notModified, true); assert.ok(calls.some(([, tag]) => tag === '"t1"') && calls.some(([, tag]) => tag === '"v1"'));
  assert.equal(questApi.getStatus().ok, true); assert.equal(questApi.getStatus().sources.length, 2);
  questApi.resetCache(); failTracker = true;
  answer = await questApi.fetchQuests();
  assert.equal(answer.notModified, false); assert.equal(answer.quests.length, 6, 'one source failing is not a problem');
  assert.equal(questApi.getStatus().sources[1].ok, false);
  questApi.resetCache(); failCommunity = true;
  await assert.rejects(() => questApi.fetchQuests({ force: true }), /could not be read/); assert.equal(questApi.getStatus().ok, false);
  failTracker = false; failCommunity = false;
  global.fetch = async () => new Response(JSON.stringify({ not: 'a list' }), { status: 200 });
  await assert.rejects(() => questApi.fetchQuests({ force: true }), /could not be read/);

  // Filters.
  assert.equal(matchesFilters(orbs, { reward_kinds: [], task_kinds: [] }), true);
  assert.equal(matchesFilters(orbs, { reward_kinds: ['decoration'], task_kinds: [] }), false);
  assert.equal(matchesFilters(deco, { reward_kinds: ['decoration', 'orbs'], task_kinds: ['play'] }), true);
  assert.equal(matchesFilters(orbs, { reward_kinds: [], task_kinds: ['play'] }), false);

  // The pass: first run remembers, the next ones alert.
  const sentMessages = [];
  const makeChannel = (guildId, fail = false) => ({ isTextBased: () => true, send: async (payload) => { if (fail) throw new Error('Missing Access'); sentMessages.push({ guildId, payload }); return { id: `m${sentMessages.length}` }; } });
  const guilds = new Map();
  const addGuild = (id, fail = false) => guilds.set(id, { id, channels: { fetch: async () => makeChannel(id, fail) } });
  addGuild('g1'); addGuild('g2'); addGuild('g3', true);
  const client = { guilds: { cache: { get: (id) => guilds.get(id) }, fetch: async (id) => guilds.get(id) ?? null } };
  const seen = new Set(); const posts = new Set();
  let configs = [
    { guild_id: 'g1', channel_id: 'c', role_id: '999', style: 'card', reward_kinds: [], task_kinds: [], hide_sections: [], accent_color: null, expiring_hours: 0 },
    { guild_id: 'g2', channel_id: 'c', role_id: null, style: 'card', reward_kinds: ['decoration'], task_kinds: [], hide_sections: ['image', 'limits'], accent_color: 0xff91c2, expiring_hours: 72 },
    { guild_id: 'g3', channel_id: 'c', role_id: null, style: 'card', reward_kinds: [], task_kinds: [], hide_sections: [], accent_color: null, expiring_hours: 0 },
  ];
  const db = {
    listEnabledConfigs: async () => configs, listSeenIds: async () => new Set(seen),
    markSeen: async (list) => list.forEach((quest) => seen.add(quest.id)),
    hasPost: async (g, q, k) => posts.has(`${g}:${q}:${k}`), savePost: async (g, q, k) => { posts.add(`${g}:${q}:${k}`); },
  };
  const future = questApi.normalizeQuest(api[4]);
  let current = [orbs, deco, future];
  const fakeApi = { fetchQuests: async () => ({ notModified: false, quests: current }), isActive: questApi.isActive };
  let result = await checkQuests(client, { api: fakeApi, db, now });
  assert.equal(result.baseline, true); assert.equal(sentMessages.length, 0, 'the first run only remembers'); assert.equal(seen.size, 2); assert.equal(seen.has(future.id), false, 'a quest that has not started is not remembered, so it is announced when it starts');
  result = await checkQuests(client, { api: fakeApi, db, now });
  assert.equal(result.sent, 0, 'nothing new, nothing sent');
  current = [orbs, deco, play, future];
  result = await checkQuests(client, { api: fakeApi, db, now });
  assert.equal(result.newQuests, 1);
  assert.deepEqual(sentMessages.map((m) => m.guildId), ['g1'], 'g2 wants decorations only and g3 cannot be reached');
  assert.equal(posts.has('g1:' + ids.play + ':new'), true); assert.equal(posts.has('g3:' + ids.play + ':new'), false);
  result = await checkQuests(client, { api: fakeApi, db, now });
  assert.equal(sentMessages.length, 1, 'a quest is never announced twice');
  result = await checkQuests(client, { api: fakeApi, db, now: now + 1.5 * day });
  assert.equal(result.newQuests, 1, 'the quest that was not started yet is announced once it starts');
  assert.equal(posts.has('g1:' + future.id + ':new'), true);
  // Ending soon: g2 asked for 72 hours and the decoration quest ends in 5 days, so wait until it is close.
  result = await checkQuests(client, { api: fakeApi, db, now: now + 3 * day });
  assert.deepEqual(sentMessages.map((m) => m.guildId), ['g1', 'g1', 'g2'], 'the ending-soon alert goes to g2 for the decoration quest only');
  assert.equal(posts.has('g2:' + ids.deco + ':expiring'), true);
  await checkQuests(client, { api: fakeApi, db, now: now + 3 * day });
  assert.equal(sentMessages.length, 3, 'the ending-soon alert is sent once');
  let reset = 0; const breakingDb = { ...db, markSeen: async () => { throw new Error('db down'); } };
  seen.clear(); seen.add('x');
  await assert.rejects(() => checkQuests(client, { api: { ...fakeApi, resetCache: () => { reset += 1; } }, db: breakingDb, now: now + 2 * day }), /db down/);
  assert.equal(reset, 1, 'a pass that could not finish makes the next one download again');
  configs = [];
  assert.equal((await checkQuests(client, { api: fakeApi, db, now })).skipped, true, 'with no server using it the API is not asked');

  // The card.
  const card = buildQuestCard(orbs, { hide_sections: [], role_id: '999' }, { rolePing: '<@&999>' });
  assert.equal(card.flags, MessageFlags.IsComponentsV2); assert.equal(card.components.length, 2);
  const json = JSON.stringify(card.components.map((c) => c.toJSON()));
  assert.ok(json.includes('Watch the trailer') && json.includes('Accept Quest') && json.includes(questApi.SOURCE_NAME) && json.includes(`https://discord.com/quests/${ids.orbs}`));
  assert.ok(json.includes('Only in US') && json.includes('18+'));
  const slim = JSON.stringify(buildQuestCard(orbs, { hide_sections: ['image', 'limits', 'tasks'], accent_color: 0xff91c2 }).components.map((c) => c.toJSON()));
  assert.ok(!slim.includes('Only in US') && !slim.includes('**Task:**') && !slim.includes('111.jpg') && slim.includes(String(0xff91c2)), 'hidden sections and the color are respected');
  assert.deepEqual(card.allowedMentions, { parse: [], roles: ['999'] });

  // The saved embed, and its fallback.
  const guild = { id: '9', name: 'Test', memberCount: 5, ownerId: '1', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'), iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  templates.quest = { content: '{quest.status}: {quest.name} for {quest.reward} ({quest.reward_amount})', embeds: [{ title: '{quest.game}', description: '{quest.tasks}\n{quest.limits}', image: { url: '{quest.image}' } }] };
  let message = await questMessage(guild, { style: 'template', embed_template: 'quest', role_id: '999' }, orbs, 'new');
  assert.ok(message.content.startsWith('<@&999>\nNew quest: Watch the trailer for 200 Orbs (200)') && message.content.includes(questApi.SOURCE_NAME));
  assert.equal(message.embeds[0].data.title, 'Some Game'); assert.ok(message.embeds[0].data.description.includes('Watch a video (2 min)'));
  message = await questMessage(guild, { style: 'template', embed_template: 'missing' }, orbs, 'expiring');
  assert.equal(message.flags, MessageFlags.IsComponentsV2, 'a missing saved embed sends the card');
  assert.equal(await resolve('{quest.name}|{quest.expires}', { quest: questContext(orbs) }).then((t) => t.startsWith('Watch the trailer|<t:')), true);
  assert.equal(await resolve('{quest.name}', {}), '', 'outside a quest the variables are empty');

  // Who can use it.
  assert.equal(canUseQuests('owner'), true); assert.equal(canUseQuests('dev'), true); assert.equal(canUseQuests('tester'), true); assert.equal(canUseQuests('someone'), false);
  settingsOfConfig.questsPublic = true; assert.equal(canUseQuests('someone'), true); settingsOfConfig.questsPublic = false;

  // The command, typed with the prefix.
  for (const file of ['src/db/guilds.js', 'src/db/quests.js', 'src/utils/caseCard.js']) stub(file, new Proxy({ DEFAULTS: {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
  stub('src/utils/emojis.js', { EMOJI: {} });
  const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
  const command = require('../src/commands/utility/quests.js');
  const channels = new Collection([['123456789012345678', { id: '123456789012345678', type: 0, name: 'quests' }]]);
  const msg = { guild: { id: '1', channels: { cache: channels }, roles: { cache: new Collection() }, members: { cache: new Collection() } }, author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '' };
  const parse = (text) => buildInteractionFromMessage(msg, command, text);
  let i = await parse('rewards orbs, decoration'); assert.deepEqual([i.options.getSubcommand(), i.options.getString('kinds')], ['rewards', 'orbs, decoration']);
  i = await parse('style template quest'); assert.deepEqual([i.options.getSubcommand(), i.options.getString('style'), i.options.getString('template')], ['style', 'template', 'quest']);
  i = await parse('card hide image'); assert.deepEqual([i.options.getSubcommand(), i.options.getString('action'), i.options.getString('section')], ['card', 'hide', 'image']);
  i = await parse('expiring 6'); assert.equal(i.options.getInteger('hours'), 6);
  assert.equal(command.data.toJSON().options.length <= 25, true);
  console.log('Checked the quest alerts: the API answer, the filters, who is told, the card, the saved embed and who can use it.');
})().catch((error) => { console.error(error); process.exit(1); });

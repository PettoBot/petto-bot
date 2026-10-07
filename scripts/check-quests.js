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
stub('src/db/senderIdentities.js', { FEATURES: [], get: async () => null });
stub('src/db/quests.js', { DEFAULTS: {}, getConfig: async () => null });
const templates = {};
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (templates[name] ? { name, data: templates[name] } : null) });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
const questApi = require('../src/utils/questApi');
const { questMessage, buildQuestCard, buildQuestList, questContext } = require('../src/utils/questMessages');
const { EMOJI } = require('../src/utils/emojis');
const { canUseQuests, matchesFilters, checkQuests, resendMissing } = require('../src/utils/questAlerts');
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
  assert.equal(orbs.name, 'Watch the trailer'); assert.equal(orbs.rewards[0].kind, 'orbs'); assert.equal(orbs.rewards[0].amount, 200); assert.equal(orbs.rewards[0].premiumAmount, 240, 'Nitro members get 20% more Orbs when the list does not say');
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
  assert.equal(answer.notModified, true); assert.equal(answer.quests.length, 6, 'when nothing changed the list is still given'); assert.ok(calls.some(([, tag]) => tag === '"t1"'));
  assert.equal(calls.filter(([link]) => link.endsWith('/api/quests')).length, 1, 'the community API is not asked again within half an hour');
  await questApi.fetchQuests({ force: true }); assert.equal(calls.filter(([link]) => link.endsWith('/api/quests')).length, 2, 'a forced read asks anyway');
  assert.equal(questApi.getStatus().ok, true); assert.equal(questApi.getStatus().sources.length, 4);
  questApi.resetCache(); failTracker = true;
  answer = await questApi.fetchQuests({ force: true });
  assert.equal(answer.notModified, false); assert.equal(answer.quests.length, 6, 'one source failing is not a problem');
  assert.equal(questApi.getStatus().sources.find((source) => source.name === 'discord-api-diff').ok, false);
  questApi.resetCache(); failCommunity = true;
  await assert.rejects(() => questApi.fetchQuests({ force: true }), /could not be read/); assert.equal(questApi.getStatus().ok, false);
  failTracker = false; failCommunity = false;
  // A rate limit pauses that source for a while, and the other one keeps working.
  questApi.resetCache(); let communityCalls = 0;
  global.fetch = async (url) => {
    if (new URL(String(url)).hostname === questApi.API_BASE.replace('https://', '')) { communityCalls += 1; return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }); }
    return new Response(JSON.stringify(trackerRows), { status: 200, headers: { etag: '"t2"' } });
  };
  answer = await questApi.fetchQuests({ force: true });
  assert.equal(answer.quests.length, 6, 'the other source answers'); assert.equal(communityCalls, 2, 'the regions and the quests were asked once each');
  questApi.resetCache();
  await questApi.fetchQuests({ force: true });
  assert.equal(communityCalls, 2, 'the limited source is not asked again while it is paused');
  assert.ok(String(questApi.getStatus().sources.find((source) => source.name === 'discordquest.com').error).includes('paused'));
  global.fetch = async () => new Response(JSON.stringify({ not: 'a list' }), { status: 200 });
  await assert.rejects(() => questApi.fetchQuests({ force: true }), /could not be read/);

  // The short list of the tracker has the quests without the `config` wrapper, and the region list has a second place to come from.
  questApi.resetCache();
  const bare = api.map((row) => ({ id: row.id, ...row.config }));
  global.fetch = async (url) => {
    const link = String(url);
    if (link.includes('/api/')) return new Response('slow down', { status: 429 });
    if (link.includes('gist.githubusercontent')) return new Response(JSON.stringify({ quests: [{ id: ids.orbs, show_age_gate: true, is_global: false, regions: { include: ['JP'], exclude: [] } }] }), { status: 200 });
    if (link.endsWith('/quest.json')) return new Response(JSON.stringify(bare), { status: 200 });
    return new Response('nope', { status: 503 });
  };
  answer = await questApi.fetchQuests({ force: true });
  assert.ok(answer.quests.length >= 5, 'the quests of the short list are read when only it answers');
  const bareOrbs = answer.quests.find((quest) => quest.id === ids.orbs);
  assert.equal(bareOrbs.name, 'Watch the trailer'); assert.deepEqual(bareOrbs.regions.include, ['JP'], 'the limits come from the tracker list when the community API is down');
  assert.equal(bareOrbs.ageGate, true); assert.equal(bareOrbs.global, false);

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
  // The files did not change between two passes, but a quest that was published before it started is active now: it must be announced.
  const configs0 = configs;
  seen.clear(); posts.clear(); sentMessages.length = 0; configs = [configs0[0]];
  const early = { ...play, id: '1999999999999999991', startsAt: new Date(now + 2 * 3_600_000), expiresAt: new Date(now + 5 * day) };
  seen.add(orbs.id); seen.add(deco.id);
  current = [orbs, deco, early];
  const unchanged = { fetchQuests: async () => ({ notModified: true, quests: current }), isActive: questApi.isActive };
  result = await checkQuests(client, { api: unchanged, db, now });
  assert.equal(result.newQuests, 0, 'before it starts there is nothing to announce');
  result = await checkQuests(client, { api: unchanged, db, now: now + 3 * 3_600_000 });
  assert.equal(result.newQuests, 1, 'when it starts it is announced, even if the files did not change');
  assert.equal(sentMessages.length, 1);
  configs = configs0;
  let reset = 0; const breakingDb = { ...db, markSeen: async () => { throw new Error('db down'); } };
  seen.clear(); seen.add('x');
  await assert.rejects(() => checkQuests(client, { api: { ...fakeApi, resetCache: () => { reset += 1; } }, db: breakingDb, now: now + 2 * day }), /db down/);
  assert.equal(reset, 1, 'a pass that could not finish makes the next one download again');
  configs = [];
  assert.equal((await checkQuests(client, { api: fakeApi, db, now })).skipped, true, 'with no server using it the API is not asked');

  const guild = { id: '9', name: 'Test', memberCount: 5, ownerId: '1', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'), iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  // The card, in the style of Discord's own quest bots.
  const flat = (node) => [node, ...(node.components ?? []).flatMap(flat), ...(node.accessory ? [node.accessory] : [])];
  const texts = (card) => card.components.flatMap((c) => flat(c.toJSON())).filter((n) => typeof n.content === 'string').map((n) => n.content).join('\n');
  const card = buildQuestCard({ ...orbs, rewards: [{ kind: 'orbs', name: '200 Orbs', amount: 200, premiumAmount: 240, image: null }] }, { hide_sections: [], role_id: '999' }, { rolePing: '<@&999>' });
  assert.equal(card.flags, MessageFlags.IsComponentsV2); assert.equal(card.components.length, 2, 'the card and a row of link buttons');
  const text = texts(card);
  assert.ok(text.startsWith(`-# <@&999>\n# ${EMOJI.QUEST_BADGE} [Watch the trailer](https://discord.com/quests/${ids.orbs})`), 'the role ping and the linked title come first');
  assert.ok(text.includes('**Starts:** <t:') && text.includes('**Ends:** <t:') && text.includes('**Platforms:** Desktop') && text.includes('**Task:** Watch a video (2:00)'));
  assert.ok(text.includes('## 🎁 Rewards') && text.includes('**Type:** Virtual currency') && text.includes(`**Amount:** 200 Orbs | ${EMOJI.QUEST_NITRO} 240`));
  assert.ok(text.includes(`## ${EMOJI.QUEST_ALERT} Limitations`) && text.includes('Users residing in United States 🇺🇸') && text.includes('Users over 18 🔞'));
  assert.ok(text.includes(questApi.SOURCE_NAME), 'the credit is there');
  const row = card.components[1].toJSON();
  assert.deepEqual(row.components.map((button) => [button.label, button.url]), [['Accept Quest', `https://discord.com/quests/${ids.orbs}`], ['Game page', 'https://example.com/game']]);
  const japan = questApi.normalizeQuest(rawQuest('1550000000000000007', { name: 'Japan only' }), { is_global: false, show_age_gate: false, regions: { include: ['JP'], exclude: ['KR'] } });
  const japanText = texts(buildQuestCard(japan, {}));
  assert.ok(japanText.includes('Users residing in Japan 🇯🇵') && japanText.includes('Not for users in South Korea 🇰🇷') && !japanText.includes('🔞'));
  const decorationText = texts(buildQuestCard({ ...deco, rewards: [{ kind: 'decoration', name: 'Cool Helmet Avatar Decoration', amount: 0, expiresAt: new Date(now + 60 * day), image: null }] }, {}));
  assert.ok(decorationText.includes('**Type:** Collectible') && decorationText.includes('**Name:** Cool Helmet Avatar Decoration') && decorationText.includes('**Expires:** <t:'));
  const slim = texts(buildQuestCard(orbs, { hide_sections: ['image', 'limits', 'tasks', 'rewards'], accent_color: 0xff91c2 }));
  assert.ok(!slim.includes('Limitations') && !slim.includes('**Task:**') && !slim.includes('Rewards'), 'hidden sections are left out');
  assert.equal(buildQuestCard(orbs, { accent_color: 0xff91c2 }).components[0].toJSON().accent_color, 0xff91c2, 'the color is respected');
  assert.deepEqual(card.allowedMentions, { parse: [], roles: ['999'] });
  const withPicture = buildQuestCard({ ...orbs, rewards: [{ ...orbs.rewards[0], image: 'https://cdn.discordapp.com/quests/1/2.png' }] }, {});
  assert.ok(flat(withPicture.components[0].toJSON()).some((n) => n.type === 11), 'a reward picture becomes the thumbnail of the rewards block');
  // A link button whose address is too long is left out, because Discord refuses the whole message for it (512 characters at most).
  const longLink = `https://example.com/game?${'x'.repeat(520)}`;
  const withLongLink = buildQuestCard({ ...orbs, link: longLink }, {});
  assert.deepEqual(withLongLink.components[1].toJSON().components.map((button) => button.label), ['Accept Quest'], 'a game page address over 512 characters has no button');
  const noButtons = buildQuestCard({ ...orbs, url: longLink, link: null }, {});
  assert.equal(noButtons.components.length, 1, 'with no button that fits there is no empty row either');
  assert.ok(flat(buildQuestCard({ ...orbs, image: `https://cdn.example/${'y'.repeat(2100)}.png` }, {}).components[0].toJSON()).every((n) => n.type !== 12), 'a picture with an address over 2048 characters is left out');
  const clocks = texts(buildQuestCard({ ...play, tasks: [{ type: 'X', kind: 'play', label: 'Play the game', platform: 'Desktop', seconds: 900 }, { type: 'Y', kind: 'video', label: 'Watch', platform: 'Mobile', seconds: 3725 }] }, {}));
  assert.ok(clocks.includes('Play the game (15:00)') && clocks.includes('Watch (1:02:05)'), 'times are shown as a clock');

  // The list of active quests: a menu with an icon for each kind of reward, and page buttons past 25 quests.
  const kinds = ['orbs', 'decoration', 'code', 'ingame', 'nitro'];
  const many = Array.from({ length: 30 }, (_, n) => ({ ...orbs, id: `16${String(n).padStart(17, '0')}`, name: `Quest number ${n + 1}`, rewards: [{ kind: kinds[n % 5], name: `Reward ${n + 1}`, amount: 200, premiumAmount: 240, image: null }], tasks: [{ type: 'WATCH_VIDEO', kind: 'video', label: 'Watch a video', platform: 'Desktop', seconds: 120 }] }));
  const listOne = buildQuestList(many, { page: 1 });
  assert.equal(listOne.flags, MessageFlags.IsComponentsV2);
  const listNodes = flat(listOne.components[0].toJSON());
  const menu = listNodes.find((n) => n.type === 3);
  assert.equal(menu.custom_id, 'quests:view'); assert.equal(menu.options.length, 10, 'a page holds 10 quests');
  assert.equal(menu.options[0].label, 'Quest number 1'); assert.equal(menu.options[0].value, many[0].id);
  assert.deepEqual(menu.options.slice(0, 5).map((o) => (o.emoji.id ? 'custom' : o.emoji.name)), ['custom', '🎭', '🎟️', '🎮', '💎'], 'each kind of reward has its own icon, Orbs the Orbs one');
  assert.ok(menu.options[0].description.startsWith('200 Orbs · Video · ends ') && menu.options.every((o) => o.description.length <= 100));
  const listText = texts(listOne);
  assert.ok(listText.includes(`# ${EMOJI.QUEST_BADGE} Active quests`) && listText.includes('30 quests · page 1 of 3 · pick one below to see its full card'));
  const buttons = listNodes.filter((n) => n.type === 2);
  assert.deepEqual(buttons.map((b) => [b.custom_id, b.disabled ?? false]), [['quests:page:0', true], ['quests:page:none', true], ['quests:page:2', false]], 'previous is off on the first page');
  const listTwo = flat(buildQuestList(many, { page: 2 }).components[0].toJSON());
  assert.equal(listTwo.find((n) => n.type === 3).options.length, 10); assert.equal(listTwo.find((n) => n.type === 3).options[0].label, 'Quest number 11');
  assert.equal(flat(buildQuestList(many, { page: 99 }).components[0].toJSON()).find((n) => n.type === 3).options[0].label, 'Quest number 21', 'a page too far gives the last one');
  const single = flat(buildQuestList([orbs], {}).components[0].toJSON());
  assert.equal(single.filter((n) => n.type === 2).length, 0, 'no page buttons for a short list'); assert.ok(texts(buildQuestList([orbs], {})).includes('1 quest'));
  assert.ok(listNodes.length <= 40 && listText.length < 4000);
  assert.ok(listText.includes('### ') && listText.includes('Quest number 1](') && listText.includes('ends <t:'), 'the list shows each quest as text, not only in the menu');
  const limited = texts(buildQuestList([{ ...orbs, regions: { include: ['US'], exclude: [] }, ageGate: true }], {}));
  assert.ok(limited.includes('Users residing in United States') && limited.includes('Users over 18'), 'the list shows the limits of each quest');
  assert.equal(listOne.components[0].toJSON().accent_color, undefined, 'no color on the list');
  assert.equal(buildQuestCard(orbs, {}).components[0].toJSON().accent_color, undefined, 'no color on the card unless the server sets one');

  // The pictures of the rewards: the Orbs icon, and the decoration from Discord's own product endpoint.
  const images = require('../src/utils/questImages');
  settingsOfConfig.verifyBaseUrl = 'https://bot.example';
  assert.equal(images.orbsIcon(), 'https://bot.example/assets/quest-orbs.png');
  const asked = [];
  const productFetch = async (url) => { asked.push(url); return url.endsWith('/1554525949758804089') ? new Response(JSON.stringify({ items: [{ type: 0, sku_id: '1554525949758804089', asset: 'a_0755beb047355c0db919fc5eddc2322a' }] }), { status: 200 }) : url.endsWith('/1554525949758804090') ? new Response(JSON.stringify({ items: [{ type: 1, asset: 'effect' }] }), { status: 200 }) : new Response('no', { status: 404 }); };
  assert.equal(await images.decorationImage('1554525949758804089', productFetch), 'https://cdn.discordapp.com/avatar-decoration-presets/a_0755beb047355c0db919fc5eddc2322a.png?size=256&passthrough=true');
  assert.equal(await images.decorationImage('1554525949758804089', productFetch), 'https://cdn.discordapp.com/avatar-decoration-presets/a_0755beb047355c0db919fc5eddc2322a.png?size=256&passthrough=true');
  assert.equal(asked.length, 1, 'a picture is asked for once and remembered');
  assert.equal(await images.decorationImage('1554525949758804090', productFetch), null, 'a profile effect is not an avatar decoration');
  assert.equal(await images.decorationImage('1554525949758804091', productFetch), null); assert.equal(await images.decorationImage('not a sku', productFetch), null);
  assert.equal(await images.decorationImage('1554525949758804092', async () => { throw new Error('offline'); }), null, 'a failure is only a missing picture');
  const withImages = await images.withRewardImages({ ...orbs, rewards: [{ kind: 'orbs', name: '200 Orbs', amount: 200, premiumAmount: 240, image: null }, { kind: 'decoration', sku: '1554525949758804089', name: 'Helmet', image: null }, { kind: 'code', name: 'Code', image: null }, { kind: 'ingame', name: 'Item', image: 'https://cdn.discordapp.com/quests/1/2.png' }] }, { fetcher: productFetch });
  assert.deepEqual(withImages.rewards.map((r) => r.image), ['https://bot.example/assets/quest-orbs.png', 'https://cdn.discordapp.com/avatar-decoration-presets/a_0755beb047355c0db919fc5eddc2322a.png?size=256&passthrough=true', null, 'https://cdn.discordapp.com/quests/1/2.png']);
  settingsOfConfig.verifyBaseUrl = null; images.clearCache();
  assert.equal(images.orbsIcon(), null, 'without a public address there is no Orbs icon, and nothing breaks');
  settingsOfConfig.verifyBaseUrl = 'https://bot.example';
  const orbCard = await questMessage(guild, { style: 'card' }, orbs, 'new');
  assert.ok(flat(orbCard.components[0].toJSON()).some((n) => n.type === 11 && n.media.url === 'https://bot.example/assets/quest-orbs.png'), 'the rewards block of an Orbs quest has the Orbs icon');

  // The menu and the buttons of the list.
  const interactions = require('../src/interactions/quests');
  const replies = [];
  questApi.getQuests = async () => [orbs, deco, ...normalized.slice(3)];
  const call = (handler, extra) => handler({ user: { id: 'owner' }, guild, reply: async (p) => replies.push(['reply', p]), update: async (p) => replies.push(['update', p]), deferUpdate: async () => replies.push(['defer']), ...extra });
  await call(interactions.handleSelect, { values: [orbs.id] });
  assert.equal(replies.at(-1)[0], 'reply'); assert.equal(replies.at(-1)[1].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, 'the card is only for who picked it');
  assert.ok(texts({ components: replies.at(-1)[1].components }).includes('Watch the trailer'));
  await call(interactions.handleSelect, { values: ['1550000000000099999'] });
  assert.ok(String(replies.at(-1)[1].content).includes('not active anymore'));
  await call(interactions.handleSelect, { values: [orbs.id], user: { id: 'someone' } });
  assert.ok(String(replies.at(-1)[1].content).includes('testing'), 'only the team while it is in testing');
  await call(interactions.handleButton, { customId: 'quests:page:2' });
  assert.equal(replies.at(-1)[0], 'update'); assert.ok(flat(replies.at(-1)[1].components[0].toJSON()).some((n) => n.type === 3));
  await call(interactions.handleButton, { customId: 'quests:page:none' });
  assert.equal(replies.at(-1)[0], 'defer', 'the counter button does nothing');
  questApi.getQuests = undefined;

  // The saved embed, and its fallback.
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
  stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
  for (const file of ['src/db/guilds.js', 'src/db/quests.js']) stub(file, new Proxy({ DEFAULTS: {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
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
  assert.equal(command.data.toJSON().default_member_permissions ?? null, null, 'the command is open, the settings check the permission themselves');

  // Anyone can list the quests; the settings need Manage Server.
  const sent = [];
  const as = async (text, manage) => {
    const fake = await parse(text);
    fake.guild = msg.guild; fake.user = { id: 'someone' }; fake.member = { permissions: { has: () => manage } };
    fake.deferReply = async () => {}; fake.editReply = async (payload) => { sent.push(JSON.stringify(payload)); };
    await command.execute(fake);
    return sent.at(-1) ?? '';
  };
  settingsOfConfig.questsPublic = true;
  assert.ok((await as('rewards orbs', false)).includes('Manage Server'), 'a member cannot change the settings');
  assert.ok((await as('test', false)).includes('Manage Server'), 'a member cannot send the test');
  assert.ok(!(await as('list', false)).includes('Manage Server'), 'a member can see the list');
  settingsOfConfig.questsPublic = false;
  // A message Discord refuses (Invalid Form Body) is not sent again in every pass: the ending-soon alert, which is not marked
  // as seen, used to be tried again every five minutes and filled the rate limit of the channel.
  {
    let attempts = 0;
    const refusing = { id: 'g9', channels: { fetch: async () => ({ isTextBased: () => true, send: async () => { attempts += 1; throw Object.assign(new Error('Invalid Form Body'), { code: 50035 }); } }) } };
    const client9 = { guilds: { cache: { get: () => refusing }, fetch: async () => refusing } };
    const ending = { ...orbs, id: 'ending-1', startsAt: new Date(now - 1000), expiresAt: new Date(now + 3_600_000) };
    const posts9 = new Set();
    const db9 = {
      listEnabledConfigs: async () => [{ guild_id: 'g9', channel_id: 'c', role_id: null, style: 'card', reward_kinds: [], task_kinds: [], hide_sections: [], accent_color: null, expiring_hours: 6 }],
      listSeenIds: async () => new Set(['ending-1']), markSeen: async () => {},
      hasPost: async (g, q, k) => posts9.has(`${g}:${q}:${k}`), savePost: async (g, q, k) => { posts9.add(`${g}:${q}:${k}`); },
    };
    const api9 = { fetchQuests: async () => ({ notModified: false, quests: [ending] }), isActive: questApi.isActive };
    await checkQuests(client9, { api: api9, db: db9, now }); await checkQuests(client9, { api: api9, db: db9, now: now + 300_000 });
    assert.equal(attempts, 1, 'a message that Discord refuses is not tried again');
    attempts = 0; posts9.clear();
    refusing.channels.fetch = async () => ({ isTextBased: () => true, send: async () => { attempts += 1; throw Object.assign(new Error('Missing Access'), { code: 50001 }); } });
    await checkQuests(client9, { api: api9, db: db9, now }); await checkQuests(client9, { api: api9, db: db9, now: now + 300_000 });
    assert.equal(attempts, 2, 'a permission problem is tried again, the owner may fix it');
  }
  // Sending again what is missing: the quests that are active, pass the filters and were never posted in the server.
  {
    const delivered = [];
    const channel9 = { isTextBased: () => true, send: async (payload) => { delivered.push(payload); return { id: `m${delivered.length}` }; } };
    const guild9 = { id: 'g8', channels: { fetch: async () => channel9 } };
    const client8 = { guilds: { cache: { get: () => guild9 }, fetch: async () => guild9 } };
    const old = { ...orbs, id: 'old-1', startsAt: new Date(now - 3 * day), expiresAt: new Date(now + 5 * day) };
    const mid = { ...orbs, id: 'mid-2', startsAt: new Date(now - 2 * day), expiresAt: new Date(now + 5 * day) };
    const done = { ...orbs, id: 'done-3', startsAt: new Date(now - 1 * day), expiresAt: new Date(now + 5 * day) };
    const gone = { ...orbs, id: 'gone-4', startsAt: new Date(now - 9 * day), expiresAt: new Date(now - 1 * day) };
    const posted8 = new Set(['g8:done-3:new']);
    const db8 = { hasPost: async (g, q, k) => posted8.has(`${g}:${q}:${k}`), savePost: async (g, q, k) => { posted8.add(`${g}:${q}:${k}`); } };
    const api8 = { fetchQuests: async () => ({ notModified: false, quests: [done, mid, gone, old] }), isActive: questApi.isActive };
    const settings8 = { guild_id: 'g8', channel_id: 'c', role_id: null, style: 'card', reward_kinds: [], task_kinds: [], hide_sections: [], accent_color: null, expiring_hours: 0 };
    let outcome = await resendMissing(client8, settings8, { api: api8, db: db8, now, pause: 0 });
    assert.deepEqual(outcome, { missing: 2, sent: 2, left: 0 }, 'the ones that were not posted, and not the posted one or the one that ended');
    assert.equal(delivered.length, 2); assert.ok(posted8.has('g8:old-1:new') && posted8.has('g8:mid-2:new'));
    outcome = await resendMissing(client8, settings8, { api: api8, db: db8, now, pause: 0 });
    assert.deepEqual(outcome, { missing: 0, sent: 0, left: 0 }, 'a second time there is nothing left to send');
    posted8.clear();
    outcome = await resendMissing(client8, { ...settings8 }, { api: api8, db: db8, now, pause: 0, limit: 2 });
    assert.deepEqual(outcome, { missing: 3, sent: 2, left: 1 }, 'a batch has a limit');
    posted8.clear();
    outcome = await resendMissing(client8, { ...settings8, reward_kinds: ['decoration'] }, { api: api8, db: db8, now, pause: 0 });
    assert.equal(outcome.missing, 0, 'the filters of the server apply');
  }
  console.log('Checked the quest alerts: the API answer, the filters, who is told, the card, the saved embed and who can use it.');
})().catch((error) => { console.error(error); process.exit(1); });

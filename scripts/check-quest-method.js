// Checks the thread and the method of quest alerts: the thread name, the method text with quest variables, the ping, where the
// method goes (thread, channel or the alert channel), and that a failure never undoes the alert.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { ownerId: 'owner', developerIds: [], questTesterIds: [], questsPublic: true });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const posts = {};
stub('src/db/quests.js', { DEFAULTS: {}, getConfig: async () => null, getPost: async (guildId, questId, kind) => posts[`${guildId}:${questId}:${kind}`] ?? null });
const templates = {};
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (templates[name] ? { name, data: templates[name] } : null) });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
const questApi = require('../src/utils/questApi');
const { questExtras, relativeText, spanText, QUEST_EXTRA_KEYS } = require('../src/utils/questTime');
const { questContext, templateForQuest, questMessage } = require('../src/utils/questMessages');
const { fillQuest, threadName, startQuestThread, methodPayload, methodTarget, sendMethod, sendMethodNow } = require('../src/utils/questMethod');

const day = 86_400_000;
const quest = { id: 'q1', name: 'Watch the trailer', game: 'Some Game', publisher: 'Pub', url: 'https://x', rewards: [{ kind: 'orbs', name: '200 Orbs', amount: 200 }], tasks: [{ kind: 'video', label: 'Watch a video', seconds: 120 }], platforms: ['desktop'], regions: { include: [], exclude: [] }, global: true, startsAt: new Date(Date.now() - day), expiresAt: new Date(Date.now() + day) };

(async () => {
  // Variables in a text: quest ones are filled, the rest stay.
  assert.equal(fillQuest('Do {quest.task} in {quest.game} {user.name}', quest), 'Do Watch a video in Some Game {user.name}');
  assert.equal(threadName({}, quest), 'Watch the trailer');
  assert.equal(threadName({ thread_name: 'Quest: {quest.name} ({quest.game})' }, quest), 'Quest: Watch the trailer (Some Game)');
  assert.equal(threadName({ thread_name: 'x'.repeat(300) }, quest).length, 100);

  // The time variables: every style, plain words for titles and footers, and the details of rewards and tasks.
  const at = Date.now();
  const timed = { ...quest, startsAt: new Date(at - 2 * day), expiresAt: new Date(at + 5 * day + 3.5 * 3_600_000), regions: { include: ['US', 'BR'], exclude: ['DE'] }, rewards: [{ kind: 'orbs', name: '200 Orbs', amount: 200, premiumAmount: 240, expiresAt: null }, { kind: 'decoration', name: 'Cool frame', amount: 0, premiumAmount: 0, expiresAt: new Date(at + day) }] };
  const extras = questExtras(timed, at);
  assert.equal(extras.starts_ago, '2 days ago');
  assert.equal(extras.expires_in, 'in 5 days');
  assert.equal(extras.time_left, '5 days 3 hours');
  assert.equal(extras.duration, '7 days 3 hours');
  assert.equal(extras.days_left, '5');
  assert.equal(extras.hours_left, '123');
  assert.equal(extras['starts.unix'], String(Math.floor((at - 2 * day) / 1000)));
  assert.ok(extras['starts.relative'].endsWith(':R>') && extras['expires.short_time'].endsWith(':t>') && extras['expires.full_long'].endsWith(':F>') && extras['starts.short_datetime'].endsWith(':s>'));
  assert.equal(extras.reward_nitro_amount, '240');
  assert.equal(extras.rewards_count, '2');
  assert.ok(extras.reward_expires.endsWith(':R>'));
  assert.equal(extras.task_type, 'video');
  assert.equal(extras.task_time, '2 min');
  assert.equal(extras.countries, 'US, BR');
  assert.equal(extras.excluded_countries, 'DE');
  assert.match(extras.starts_datetime, /UTC$/);
  assert.equal(relativeText(at + 10_000, at), 'now');
  assert.equal(relativeText(at - 90 * 60_000, at), '1 hour ago');
  assert.equal(relativeText(at + 3 * 60_000, at), 'in 3 minutes');
  assert.equal(extras.time_left && spanText(30_000), '');
  const ended = questExtras({ ...timed, expiresAt: new Date(at - 3_600_000) }, at);
  assert.equal(ended.time_left, 'Ended');
  assert.equal(ended.expires_in, 'ended 1 hour ago');
  assert.equal(ended.days_left, '0');
  for (const key of QUEST_EXTRA_KEYS) assert.ok(key in extras, `${key} has a value`);
  assert.ok(Object.keys(questContext(timed)).includes('starts.relative'), 'the quest context has them');
  assert.equal(fillQuest('Ends {quest.expires_in}, left {quest.time_left}, {quest.starts.unix}', timed), `Ends in 5 days, left 5 days 3 hours, ${Math.floor(timed.startsAt.getTime() / 1000)}`);

  // The method text and its ping.
  const full = { name: 'Test', memberCount: 5, ownerId: '1', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'), iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, emojis: { cache: new Collection() } };
  const guild = { ...full, id: 'g1', channels: { cache: new Collection(), fetch: async (id) => ({ id, isTextBased: () => true, send: async (p) => { sent.push({ id, p }); return { id: 'm' }; } }) } };
  const sent = [];
  assert.equal(await methodPayload(guild, { method_text: '   ' }, quest), null);
  const plain = await methodPayload(guild, { method_text: 'Step 1: {quest.task}' }, quest);
  assert.equal(plain.content, 'Step 1: Watch a video');
  assert.deepEqual(plain.allowedMentions, { parse: [], roles: [] });
  const pinged = await methodPayload(guild, { method_text: 'Hi', method_ping: true, role_id: '123456789012345678' }, quest);
  assert.equal(pinged.content, '<@&123456789012345678>\nHi');
  assert.deepEqual(pinged.allowedMentions.roles, ['123456789012345678']);
  const noRole = await methodPayload(guild, { method_text: 'Hi', method_ping: true }, quest);
  assert.equal(noRole.content, 'Hi');

  // An embed for each kind of reward: the kind of the quest picks it, the general one is the fallback.
  templates.guide = { content: 'From the embed {quest.name}', embeds: [{ description: 'Steps for {quest.game}' }] };
  templates.orbsGuide = { content: 'Orbs guide {quest.name}', embeds: [{ description: 'orbs' }] };
  templates.frameGuide = { content: 'Frame guide', embeds: [{ description: 'frame' }] };
  const kinds = { method_type_templates: { orbs: 'orbsGuide', decoration: 'frameGuide' }, method_template: 'guide' };
  assert.ok((await methodPayload(guild, kinds, quest)).content.startsWith('Orbs guide Watch the trailer'));
  const framed = { ...quest, rewards: [{ kind: 'decoration', name: 'Cool frame', amount: 0, premiumAmount: 0, expiresAt: null }] };
  assert.equal((await methodPayload(guild, kinds, framed)).content, 'Frame guide');
  const codeQuest = { ...quest, rewards: [{ kind: 'code', name: 'A code', amount: 0, premiumAmount: 0, expiresAt: null }] };
  assert.ok((await methodPayload(guild, kinds, codeQuest)).embeds.length, 'a kind without an embed uses the general one');
  assert.equal((await methodPayload(guild, { method_type_templates: { orbs: 'missing' }, method_text: 'T' }, quest)).content, 'T', 'a missing one falls back to the text');
  assert.equal(templateForQuest({ orbs: 'a', nitro: 'b' }, { rewards: [{ kind: 'code' }, { kind: 'nitro' }, { kind: 'orbs' }] }), 'b', 'the first reward with an embed');
  assert.equal(templateForQuest(null, quest), null);
  assert.equal(templateForQuest({ orbs: '  ' }, quest), null);
  const alert = await questMessage(guild, { style: 'card', type_templates: { orbs: 'orbsGuide' } }, quest, 'new');
  assert.ok(alert.content.includes('Orbs guide Watch the trailer'), 'an embed for the reward is used even with the card style');
  const fallbackAlert = await questMessage(guild, { style: 'template', embed_template: 'guide', type_templates: { orbs: 'missing' } }, quest, 'new');
  assert.ok(fallbackAlert.embeds.length, 'a missing embed for the reward uses the general one');

  // A saved embed that is missing falls back to the text.
  const fallback = await methodPayload(guild, { method_template: 'gone', method_text: 'Text' }, quest);
  assert.equal(fallback.content, 'Text');
  templates.guide = { content: 'From the embed {quest.name}', embeds: [{ description: 'Steps for {quest.game}' }] };
  const fromEmbed = await methodPayload(guild, { method_template: 'guide', method_ping: true, role_id: '123456789012345678' }, quest);
  assert.ok(fromEmbed.embeds.length, 'the saved embed is used');
  assert.ok(fromEmbed.content.includes('<@&123456789012345678>'));

  // Where it goes.
  const thread = { id: 't1', isTextBased: () => true, send: async (p) => { sent.push({ id: 't1', p }); return { id: 'm' }; } };
  assert.equal((await methodTarget(guild, { method_target: 'thread', channel_id: 'c1' }, thread)).id, 't1');
  assert.equal((await methodTarget(guild, { method_target: 'thread', channel_id: 'c1' }, null)).id, 'c1');
  assert.equal((await methodTarget(guild, { method_target: 'channel', method_channel_id: 'c2', channel_id: 'c1' }, thread)).id, 'c2');
  assert.equal((await methodTarget(guild, { method_target: 'channel', channel_id: 'c1' }, thread)).id, 'c1');
  assert.equal(await methodTarget(guild, { method_target: 'thread' }, null), null);
  sent.length = 0;
  assert.equal(await sendMethod(guild, { method_text: 'Hi', method_target: 'thread', channel_id: 'c1' }, quest, thread), thread);
  assert.equal(sent[0].id, 't1');
  assert.equal(await sendMethod(guild, { method_text: '', channel_id: 'c1' }, quest, thread), null);

  // The thread: its name, its archive time, the ping inside it, and a failure that does not throw.
  const calls = [];
  const message = { startThread: async (options) => { calls.push(options); return { id: 't2', send: async (p) => { calls.push(p); } }; } };
  const made = await startQuestThread(message, { thread_ping: true, role_id: '123456789012345678', thread_archive: 4320 }, quest);
  assert.equal(made.id, 't2');
  assert.equal(calls[0].name, 'Watch the trailer');
  assert.equal(calls[0].autoArchiveDuration, 4320);
  assert.equal(calls[1].content, '<@&123456789012345678>');
  assert.equal((await startQuestThread({ startThread: async () => { throw new Error('Missing Permissions'); } }, {}, quest)), null);
  const badArchive = [];
  await startQuestThread({ startThread: async (o) => { badArchive.push(o); return { send: async () => {} }; } }, { thread_archive: 7 }, quest);
  assert.equal(badArchive[0].autoArchiveDuration, 1440);

  // Sending the method now: the quest, the thread of its alert, and the messages when something is missing.
  const api = { getQuests: async () => [quest], isActive: () => true };
  const channelWithThread = { id: 'c1', isTextBased: () => true, messages: { fetch: async () => ({ thread }) }, send: async (p) => { sent.push({ id: 'c1', p }); return { id: 'm' }; } };
  const guild2 = { ...full, id: 'g1', channels: { cache: new Collection(), fetch: async (id) => (id === 'c1' ? channelWithThread : null) } };
  posts['g1:q1:new'] = { message_id: 'alert1' };
  sent.length = 0;
  const ok = await sendMethodNow(guild2, { guild_id: 'g1', channel_id: 'c1', method_text: 'Do it', method_target: 'thread' }, { api });
  assert.equal(ok.ok, true);
  assert.equal(sent[0].id, 't1');
  assert.equal((await sendMethodNow(guild2, { guild_id: 'g1', channel_id: 'c1' }, { api })).ok, false);
  assert.equal((await sendMethodNow(guild2, { guild_id: 'g1', channel_id: 'c1', method_text: 'x' }, { api, questId: 'nope' })).ok, false);
  assert.equal((await sendMethodNow(guild2, { guild_id: 'g1', channel_id: 'c1', method_text: 'x' }, { api: { getQuests: async () => { throw new Error('down'); }, isActive: () => true } })).ok, false);
  void questApi;
  console.log('quest method ok');
})().catch((error) => { console.error(error); process.exit(1); });

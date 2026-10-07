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
const { fillQuest, threadName, startQuestThread, methodPayload, methodTarget, sendMethod, sendMethodNow } = require('../src/utils/questMethod');

const day = 86_400_000;
const quest = { id: 'q1', name: 'Watch the trailer', game: 'Some Game', publisher: 'Pub', url: 'https://x', rewards: [{ kind: 'orbs', name: '200 Orbs', amount: 200 }], tasks: [{ kind: 'video', label: 'Watch a video', seconds: 120 }], platforms: ['desktop'], regions: { include: [], exclude: [] }, global: true, startsAt: new Date(Date.now() - day), expiresAt: new Date(Date.now() + day) };

(async () => {
  // Variables in a text: quest ones are filled, the rest stay.
  assert.equal(fillQuest('Do {quest.task} in {quest.game} {user.name}', quest), 'Do Watch a video in Some Game {user.name}');
  assert.equal(threadName({}, quest), 'Watch the trailer');
  assert.equal(threadName({ thread_name: 'Quest: {quest.name} ({quest.game})' }, quest), 'Quest: Watch the trailer (Some Game)');
  assert.equal(threadName({ thread_name: 'x'.repeat(300) }, quest).length, 100);

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

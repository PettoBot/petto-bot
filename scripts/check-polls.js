// Checks the poll messages: the default Components V2 card, a saved V2 design with the {poll.*} variables and the vote
// buttons under it, the fallbacks (no design, missing, not V2), and what the dashboard asks the bot to draw.
const assert = require('node:assert/strict');
const path = require('node:path');
const { MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const templates = {};
stub('src/config.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (templates[name] ? { name, data: templates[name] } : null) });
stub('src/utils/cardService.js', { renderCardForMessage: async () => null, normalizeCardRef: () => null, CARD_FILE_NAME: 'card.png' });
const { updatePollMessage, buildPollCard, buildPollMessage, pollContext, checkPollTemplate } = require('../src/utils/pollCard');
const { readPollRequest, renderPollRequest } = require('../src/utils/pollApi');
const { resolve } = require('../src/utils/embedVariables');

const guild = { id: '9', name: 'Test Server', memberCount: 50, ownerId: '5', premiumTier: 0, premiumSubscriptionCount: 0, createdAt: new Date('2020-01-01'), iconURL: () => null, bannerURL: () => null, members: { cache: new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() }, emojis: { cache: new Map() } };
const poll = { id: 7, question: 'What should we build next?', options: ['A new command', 'A dashboard module', 'More docs'], image: null, multi: false, closed: false, ends_at: null, creator_id: '123456789012345678', embed_template: null };
const results = { counts: [3, 1, 0], voters: 4 };
const text = (components) => JSON.stringify(components.map((c) => c.toJSON()));

(async () => {
  // The default card.
  const card = buildPollCard(poll, results);
  const json = card.components[0].toJSON();
  assert.equal(json.type, 17, 'a Components V2 container');
  assert.equal(json.components.filter((c) => c.type === 14).length, 2, 'a line under the header and one above the votes');
  const body = text(card.components);
  assert.match(body, /### 📊 What should we build next\?/);
  assert.match(body, /Single choice/);
  assert.match(body, /75% \(3\)/);
  assert.match(body, /4 votes · open/);
  assert.equal(card.rows.length, 2, 'three options are one row of buttons, plus End poll');
  assert.equal(card.rows[0].components.length, 3);

  // A poll that closes later says so, and a closed one marks the winner and drops its buttons.
  const timed = buildPollCard({ ...poll, ends_at: '2030-01-01T00:00:00.000Z' }, results);
  assert.match(text(timed.components), /closes <t:1893456000:R>/);
  const closed = buildPollCard({ ...poll, closed: true }, results);
  assert.equal(closed.rows.length, 0);
  assert.match(text(closed.components), /A new command\*\* 🏆/);
  assert.equal(/Single choice · closed/.test(text(closed.components)), true);
  const tie = text(buildPollCard({ ...poll, closed: true }, { counts: [2, 2, 0], voters: 4 }).components);
  assert.equal((tie.match(/🏆/g) || []).length, 2, 'a tie marks both');
  const many = buildPollCard({ ...poll, options: Array.from({ length: 10 }, (_, i) => `Option ${i}`) }, { counts: new Array(10).fill(0), voters: 0 });
  assert.equal(many.rows.length, 3, 'ten options are two rows of five plus End poll');

  // The default message.
  const message = await buildPollMessage({ guild, poll, results });
  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.equal(message.components.length, 3);

  // The variables.
  const ctx = pollContext(poll, results);
  assert.equal(ctx.votes, 4); assert.equal(ctx.votesText, '4 votes'); assert.equal(ctx.status, 'Open'); assert.equal(ctx.type, 'Single choice'); assert.equal(ctx.winner, 'A new command');
  assert.equal(pollContext(poll, { counts: [2, 2, 0], voters: 4 }).winner, '', 'a tie has no winner');
  assert.equal(pollContext({ ...poll, multi: true, closed: true }, results).status, 'Closed');
  const resolved = await resolve('{poll.question} {poll.votes_text} {poll.status} {poll.host}', { guild, poll: ctx });
  assert.equal(resolved, 'What should we build next? 4 votes Open <@123456789012345678>');

  // A saved V2 design.
  templates.design = { v2: { components: [{ type: 17, accent_color: 0x8399ff, components: [{ type: 10, content: '# {poll.question}\n{poll.results}' }, { type: 10, content: '-# {poll.votes_text} · {poll.status}' }] }] } };
  templates.classic = { embeds: [{ title: 'Classic' }] };
  assert.equal(await checkPollTemplate('9', 'design'), 'ok');
  assert.equal(await checkPollTemplate('9', 'classic'), 'not_v2');
  assert.equal(await checkPollTemplate('9', 'nothing'), 'missing');
  const designed = await buildPollMessage({ guild, poll: { ...poll, embed_template: 'design' }, results });
  assert.equal(designed.flags, MessageFlags.IsComponentsV2);
  const designedText = JSON.stringify(designed.components.map((c) => (c.toJSON ? c.toJSON() : c)));
  assert.match(designedText, /# What should we build next\?/);
  assert.match(designedText, /75% \(3\)/, 'the results variable carries the bars');
  assert.match(designedText, /4 votes · Open/);
  assert.equal(designed.components.length, 3, 'the design, a row of votes and End poll');
  assert.match(designedText, /plv_vote::7::0/);
  const designedClosed = await buildPollMessage({ guild, poll: { ...poll, closed: true, embed_template: 'design' }, results });
  assert.equal(designedClosed.components.length, 1, 'a closed poll has no buttons');
  assert.match(JSON.stringify(designedClosed.components.map((c) => (c.toJSON ? c.toJSON() : c))), /4 votes · Closed/);

  // Fallbacks: a missing design, a classic embed, and no guild all give the default card.
  for (const name of ['nothing', 'classic']) {
    const fallback = await buildPollMessage({ guild, poll: { ...poll, embed_template: name }, results });
    assert.match(JSON.stringify(fallback.components.map((c) => c.toJSON())), /### 📊 What should we build next\?/, name);
  }
  const noGuild = await buildPollMessage({ guild: null, poll: { ...poll, embed_template: 'design' }, results });
  assert.match(JSON.stringify(noGuild.components.map((c) => c.toJSON())), /### 📊/);

  // Old classic polls are not edited into V2.
  const edits = [];
  const fake = (v2) => ({ flags: { has: () => v2 }, edit: async (body) => { edits.push(body); } });
  await updatePollMessage(fake(false), { guild, poll, results });
  assert.equal(edits.length, 0, 'an open classic poll is left alone');
  await updatePollMessage(fake(false), { guild, poll: { ...poll, closed: true }, results });
  assert.deepEqual(edits.pop(), { components: [] }, 'a closed one only loses its buttons');
  await updatePollMessage(fake(true), { guild, poll, results });
  assert.equal(edits.pop().flags, MessageFlags.IsComponentsV2);

  // What the dashboard sends.
  assert.equal(readPollRequest(null), null);
  assert.equal(readPollRequest({ poll: { question: '', options: ['a', 'b'] } }), null, 'a question is needed');
  assert.equal(readPollRequest({ poll: { question: 'Q', options: ['only'] } }), null, 'two options are needed');
  assert.equal(readPollRequest({ poll: { question: 'Q', options: Array.from({ length: 11 }, (_, i) => `o${i}`) } }), null, 'ten at most');
  const request = readPollRequest({ poll: { id: '12', question: ' Q ', options: ['a', 'b'], image: 'javascript:alert(1)', multi: true, embed_template: ' design ', creator_id: 'x' }, counts: [-5, '2', 'nope'], voters: 2 });
  assert.equal(request.poll.id, 12); assert.equal(request.poll.question, 'Q'); assert.equal(request.poll.image, null, 'only web addresses'); assert.equal(request.poll.embed_template, 'design'); assert.equal(request.poll.creator_id, null);
  assert.deepEqual(request.results, { counts: [0, 2], voters: 2 });
  const rendered = await renderPollRequest(guild, { poll: { id: 7, question: 'Q?', options: ['a', 'b'], embed_template: 'design' }, counts: [1, 0], voters: 1 });
  assert.equal(rendered.flags, MessageFlags.IsComponentsV2);
  assert.ok(rendered.components.every((component) => typeof component.type === 'number'), 'plain JSON the web can send to Discord');
  assert.equal(JSON.parse(JSON.stringify(rendered)).components.length, 3);
  assert.equal(await renderPollRequest(guild, { poll: { question: '', options: [] } }), null);

  console.log('polls ok');
})().catch((error) => { console.error(error); process.exit(1); });

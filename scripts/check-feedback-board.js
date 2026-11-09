// The feedback board in Discord, done by Petto (it used to be the `feed` bot): the card of a post, the Like and Dislike buttons (one vote per
// person, the same button again takes it back), the routes the website calls to publish, redraw and delete the card, a card written by another
// bot (the old one) being replaced, and /feedback.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const config = require('../src/config');
const db = require('../src/db/feedback');
const card = require('../src/feedback/card');
const service = require('../src/feedback/service');
const votes = require('../src/interactions/feedbackVotes');
const { handleCard } = require('../src/web/feedbackBoardRoutes');
const command = require('../src/commands/info/feedback');

(async () => {
  const post = { id: '7', kind: 'idea', title: 'A new command', body: 'Do this @everyone <@123456789012345678>', tags: ['commands', 'quests'], status: 'planned', status_note: 'Soon', username: 'Liam', votes_up: 5, votes_down: 1, comments_count: 2 };

  // --- the card
  assert.equal(card.safe('hi @everyone and @here', 100), 'hi @​everyone and @​here');
  assert.equal(card.safe('<@123> <@&456> <@!789>', 100), '<​@123> <​@&456> <​@!789>');
  assert.equal(card.safe('x'.repeat(50), 10).length, 10);
  const message = card.buildPost(post, 'https://petto.sbs/');
  assert.equal(message.flags, 32768, 'Components V2');
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.ok(!('accent_color' in message.components[0]), 'no color bar');
  const text = JSON.stringify(message.components);
  assert.ok(text.includes('A new command') && text.includes('Planned') && text.includes('Commands · Quests') && text.includes('Soon'));
  assert.ok(!text.includes('<@123456789012345678>'), 'the mention in the text is broken');
  const [like, dislike, comments, open] = message.components[1].components;
  assert.deepEqual([like.custom_id, like.label, like.style], ['fb:up:7', '5', 2]);
  assert.deepEqual([dislike.custom_id, dislike.label], ['fb:down:7', '1']);
  assert.equal(comments.url, 'https://petto.sbs/feedback/7#comments');
  assert.equal(comments.label, 'Comments (2)');
  assert.equal(open.url, 'https://petto.sbs/feedback/7');
  assert.equal(card.buildPost({ id: 1, title: 'Hi' }, 'https://petto.sbs').components[1].components[0].label, '0', 'a post with only the basics builds');
  for (const status of ['open', 'planned', 'in_progress', 'done', 'declined']) for (const kind of ['idea', 'feedback', 'bug']) assert.ok(JSON.stringify(card.buildPost({ ...post, status, kind }, 'https://petto.sbs')).length < 6000);
  assert.deepEqual(card.parseVoteId(card.voteId('up', 7)), { postId: 7, value: 1 });
  assert.deepEqual(card.parseVoteId('fb:down:12'), { postId: 12, value: -1 });
  for (const id of ['fb:sideways:1', 'fb:up:x', 'x', '', undefined, 'fb:up:1234567890123']) assert.equal(card.parseVoteId(id), null, `${id} is not ours`);

  // --- the votes (a fake database that keeps the votes and counts them like the triggers do)
  const store = new Map();
  const fake = {
    posts: { 7: { ...post } },
    async getPost(id) { const row = this.posts[id]; if (!row) return null; const mine = [...store.entries()].filter(([key]) => key.startsWith(`${id}:`)).map(([, value]) => value); return { ...row, votes_up: mine.filter((v) => v === 1).length, votes_down: mine.filter((v) => v === -1).length }; },
    async currentVote(id, user) { return store.get(`${id}:${user}`) ?? 0; },
    async setVote(id, user, value) { if (value) store.set(`${id}:${user}`, value); else store.delete(`${id}:${user}`); },
  };
  const U = { id: '111111111111111111' };
  let result = await votes.vote({ customId: 'fb:up:7', user: U, lang: 'en' }, { db: fake });
  assert.equal(result.vote, 1);
  assert.equal(result.post.votes_up, 1);
  assert.ok(JSON.stringify(result.reply.components).includes('You liked') && JSON.stringify(result.reply.components).includes('A new command'));
  assert.equal(result.reply.flags & 64, 64, 'only the person sees it');
  assert.equal(result.reply.flags & 32768, 32768, 'it is Components V2');
  result = await votes.vote({ customId: 'fb:down:7', user: U, lang: 'en' }, { db: fake });
  assert.equal(result.vote, -1, 'the other button changes the vote');
  assert.deepEqual([result.post.votes_up, result.post.votes_down], [0, 1]);
  assert.ok(JSON.stringify(result.reply.components).includes('You disliked'));
  result = await votes.vote({ customId: 'fb:down:7', user: U, lang: 'es' }, { db: fake });
  assert.equal(result.vote, 0, 'the same button again takes it back');
  assert.ok(JSON.stringify(result.reply.components).includes('quitó'), 'the answer is in the language of the person');
  assert.equal(store.size, 0);
  assert.deepEqual(await votes.vote({ customId: 'other', user: U, lang: 'en' }, { db: fake }), { ignored: 'id' });
  assert.deepEqual(await votes.vote({ customId: 'fb:up:7', user: { id: '1', bot: true }, lang: 'en' }, { db: fake }), { ignored: 'user' });
  result = await votes.vote({ customId: 'fb:up:99', user: U, lang: 'en' }, { db: fake });
  assert.ok(JSON.stringify(result.reply.components).includes('does not exist') && !result.post, 'a post that is gone');
  const flood = { id: '222222222222222222' };
  for (let i = 0; i < 120; i += 1) assert.equal(votes.tooMany(flood.id, 1_000), false);
  assert.equal(votes.tooMany(flood.id, 1_000), true, 'too many presses in an hour');
  assert.equal(votes.tooMany(flood.id, 1_000 + 3_600_001), false, 'and allowed again after it');

  // --- the service (a fake Discord)
  const calls = [];
  const saved = [];
  db.saveMessage = async (...args) => { saved.push(args); };
  const client = (behavior = {}) => ({
    rest: {
      post: async (route, options) => { calls.push(['post', route]); return { id: 'm-new', channel_id: 'chan', ...options && {} }; },
      patch: async (route) => { calls.push(['patch', route]); if (behavior.patch) throw behavior.patch; return { id: 'm-old', channel_id: 'chan' }; },
      delete: async (route) => { calls.push(['delete', route]); if (behavior.delete) throw behavior.delete; },
    },
  });
  config.feedbackChannelId = null;
  assert.equal(service.enabled(), false);
  assert.equal(await service.publish(client(), post), null, 'without a channel nothing is published');
  config.feedbackChannelId = 'chan';
  assert.deepEqual(await service.publish(client(), post), { channelId: 'chan', messageId: 'm-new' });
  assert.deepEqual(saved.at(-1), ['7', 'chan', 'm-new'], 'the message is remembered');
  calls.length = 0;
  assert.deepEqual(await service.update(client(), { ...post, discord_message_id: 'm-old' }), { channelId: 'chan', messageId: 'm-old' });
  assert.deepEqual(calls.map((c) => c[0]), ['patch'], 'a card of Petto is edited');
  calls.length = 0;
  assert.equal((await service.update(client({ patch: Object.assign(new Error('gone'), { status: 404, code: 10008 }) }), { ...post, discord_message_id: 'm-old' })).messageId, 'm-new');
  assert.deepEqual(calls.map((c) => c[0]), ['patch', 'post'], 'a card that is gone is published again');
  calls.length = 0;
  assert.equal((await service.update(client({ patch: Object.assign(new Error('other author'), { status: 403, code: 50005 }) }), { ...post, discord_message_id: 'm-old' })).messageId, 'm-new');
  assert.deepEqual(calls.map((c) => c[0]), ['patch', 'delete', 'post'], 'the card of the old bot is deleted and published again as Petto\'s own');
  await assert.rejects(service.update(client({ patch: Object.assign(new Error('boom'), { status: 500 }) }), { ...post, discord_message_id: 'm-old' }), /boom/);
  assert.equal((await service.update(client(), post)).messageId, 'm-new', 'a post with no card gets one');
  calls.length = 0;
  await service.remove(client(), { ...post, discord_message_id: 'm-old' });
  assert.deepEqual(calls.map((c) => c[0]), ['delete']);
  await service.remove(client({ delete: Object.assign(new Error('gone'), { status: 404, code: 10008 }) }), { ...post, discord_message_id: 'm-old' });
  assert.equal(await service.remove(client(), post), null, 'a post with no card has nothing to delete');

  // --- the routes the website calls
  const board = { enabled: () => true, publish: async (c, p) => ({ channelId: 'chan', messageId: `pub-${p.id}` }), update: async (c, p) => ({ channelId: 'chan', messageId: `upd-${p.id}` }), remove: async (c, p) => { board.removed = p; return null; } };
  const posts = { getPost: async (id) => (Number(id) === 7 ? post : null) };
  const run = (action, body, extra = {}) => handleCard({}, action, body, { db: posts, service: { ...board, ...extra } });
  assert.deepEqual(await run('publish', { post: { id: 7 } }), { status: 200, body: { ok: true, channelId: 'chan', messageId: 'pub-7' } });
  assert.deepEqual((await run('update', { post: { id: '7' } })).body.messageId, 'upd-7');
  assert.equal((await run('update', { post: { id: 8 } })).status, 404, 'a post that does not exist');
  assert.equal((await run('update', { post: { id: 'x' } })).status, 400);
  assert.equal((await run('update', {})).status, 400);
  assert.equal((await run('explode', { post: { id: 7 } })).status, 404);
  assert.equal((await run('publish', { post: { id: 7 } }, { enabled: () => false })).status, 503, 'no channel set');
  assert.equal((await run('publish', { post: { id: 7 } }, { publish: async () => { throw new Error('Missing Access'); } })).status, 502);
  const removed = await run('remove', { post: { id: 9, discord_channel_id: 'c9', discord_message_id: 'm9' } });
  assert.equal(removed.status, 200);
  assert.deepEqual([board.removed.id, board.removed.discord_channel_id, board.removed.discord_message_id], [9, 'c9', 'm9'], 'a post already out of the database is deleted with what the website knew');

  let drawn = 0;
  const bulk = { enabled: () => true, republishAll: async () => { drawn += 1; return 3; } };
  assert.deepEqual(await handleCard({}, 'republish', {}, { db: posts, service: bulk }), { status: 200, body: { ok: true, started: true } });
  assert.deepEqual((await handleCard({}, 'republish', {}, { db: posts, service: bulk })).body, { ok: true, started: false }, 'one run at a time');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(drawn, 1);
  assert.equal((await handleCard({}, 'republish', {}, { db: posts, service: { ...bulk, enabled: () => false } })).status, 503);

  // --- /feedback
  assert.ok(command.data.description.length <= 100);
  const answer = command.buildFeedbackAnswer('en', 'https://petto.sbs');
  assert.equal(answer.flags & 64, 64);
  assert.equal(answer.flags & 32768, 32768);
  const body = JSON.stringify(answer.components.map((c) => c.toJSON()));
  const boardUrl = 'https://petto.sbs/feedback';
  const sentence = require('../src/i18n').t('en', 'feedback.command.share', { url: boardUrl });
  assert.ok(body.includes(sentence) && body.includes('take the vote back'), 'the text names the board');
  assert.deepEqual(answer.components[1].toJSON().components.map((button) => button.url), [boardUrl, `${boardUrl}/new`]);
  assert.ok(JSON.stringify(command.buildFeedbackAnswer('es', 'https://petto.sbs').components.map((c) => c.toJSON())).includes('Tablero de feedback'));

  console.log('The feedback board in Discord works.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

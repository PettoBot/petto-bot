// Checks the sticky messages: text, a saved embed (also a V2 design), a missing embed falling back to the text, and the
// repost at the bottom of the channel.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/config.js', { stickyQuietMs: 350, stickyMaxWaitMs: 2000 });
const reacted = [];
const templates = new Map();
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });
let sticky = null;
const written = [];
stub('src/db/stickyMessages.js', {
  getSticky: async () => sticky,
  setMessageId: async (guildId, channelId, id) => { written.push(id); sticky = { ...sticky, message_id: id }; },
});

const { stickyPayload } = require('../src/utils/stickyPayload');
const event = require('../src/events/messageCreateSticky');

(async () => {
  const source = { guild: { id: 'g' }, channel: { id: 'c' }, member: null, author: { id: 'u' } };
  assert.deepEqual(await stickyPayload({ content: 'Read the rules', embed_template: null }, source), { content: 'Read the rules' });
  assert.equal(await stickyPayload({ content: '', embed_template: null }, source), null, 'an empty sticky sends nothing');
  templates.set('g:rules', { embeds: [{ title: 'Rules' }], components: [], files: [], reactions: ['🌸'] });
  assert.deepEqual((await stickyPayload({ content: 'text', embed_template: 'rules' }, source)).embeds, [{ title: 'Rules' }], 'the saved embed wins');
  templates.set('g:v2', { content: undefined, embeds: [], components: [{ type: 17 }], files: [], flags: 32768 });
  assert.equal((await stickyPayload({ content: '', embed_template: 'v2' }, source)).flags, 32768, 'a V2 design keeps its flag');
  assert.deepEqual(await stickyPayload({ content: 'fallback', embed_template: 'gone' }, source), { content: 'fallback' }, 'a missing embed gives the text');
  assert.equal(await stickyPayload({ content: '', embed_template: 'gone' }, source), null, 'a missing embed and no text sends nothing');

  // The repost through the event (real timers; the quiet time is 350 ms here): one message, the old sticky goes after the new one.
  const log = [];
  const sent = [];
  const channel = {
    id: 'c', isTextBased: () => true,
    messages: { fetch: async () => { throw new Error('the repost does not fetch'); }, delete: async (id) => { log.push(`delete:${id}`); } },
    send: async (payload) => { sent.push(payload); log.push(`send:new${sent.length}`); return { id: String(1000 + sent.length), react: async (emoji) => { reacted.push(emoji); } }; },
  };
  const post = (over = {}) => ({ id: '10', author: { id: 'u', bot: false }, guild: { id: 'g' }, channel, member: null, ...over });
  sticky = { message_id: '5', content: 'Rules', embed_template: 'rules' };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 700));
  await event.execute(post()); await settle();
  assert.deepEqual(log, ['send:new1', 'delete:5'], 'the new sticky is sent first, the old one deleted after');
  assert.deepEqual(sent[0].embeds, [{ title: 'Rules' }]); assert.deepEqual(written, ['1001']); assert.deepEqual(reacted, ['🌸'], 'the reactions of the embed go on the sticky');
  await event.execute(post({ id: '1001' })); await settle(); assert.equal(sent.length, 1, 'the sticky itself does not make another');
  await event.execute(post({ id: '11', author: { id: 'b', bot: true } })); await settle(); assert.equal(sent.length, 1, 'bots do not make another');
  sticky = { message_id: null, content: '', embed_template: 'gone' };
  await event.execute(post({ id: '12' })); await settle(); assert.equal(sent.length, 1, 'nothing is sent when there is nothing to send');

  // The flow with a fake clock and a fake channel that takes time to answer.
  const { createStickyReposter, rateLimitWaitMs } = require('../src/utils/stickyRepost');
  function world({ sendMs = 120, deleteMs = 80, quietMs = 350, maxWaitMs = 2000, stickyRow = { message_id: '5', content: 'Rules' }, hooks = {} } = {}) {
    let t = 0; let seq = 0; const timers = []; const sleepers = [];
    const w = { t: () => t, sent: [], deleted: [], saved: [], errors: [], warns: [], timeline: [], row: stickyRow };
    const later = (ms) => new Promise((resolve) => { sleepers.push({ at: t + ms, resolve, n: seq++ }); });
    const mkChannel = (id) => ({
      id,
      messages: { delete: async (mid) => { await later(deleteMs); if (hooks.deleteError) throw hooks.deleteError(mid); w.deleted.push({ id: mid, at: t }); w.timeline.push(`delete:${mid}`); } },
      send: async (payload) => {
        if (hooks.beforeSend) await hooks.beforeSend(w);
        await later(sendMs);
        if (hooks.sendError) { const error = hooks.sendError(w); if (error) throw error; }
        const id = String(Number(w.mid(t - sendMs / 2)) + 1); w.sent.push({ id, at: t, payload }); w.timeline.push(`send:${id}`);
        w.lastSent = id; return { id };
      },
    });
    w.mid = (ms) => String(1_000_000 + ms * 1000); // a snowflake grows with time: the sticky gets its id in the middle of its send
    w.channels = {}; w.channel = (id = 'c') => (w.channels[id] ??= mkChannel(id));
    w.reposter = createStickyReposter({
      getSticky: async () => w.row,
      setMessageId: async (g, c, id) => { w.saved.push(id); w.row = { ...w.row, message_id: id }; },
      buildPayload: async () => ({ content: 'Rules' }),
      logger: { warn: (m) => w.warns.push(m), error: (m) => w.errors.push(m), info() {} },
      quietMs, maxWaitMs,
      now: () => t,
      setTimer: (fn, ms) => { const timer = { at: t + ms, fn, n: seq++, live: true }; timers.push(timer); return timer; },
      clearTimer: (timer) => { if (timer) timer.live = false; },
    });
    w.message = (id, channelId = 'c', over = {}) => ({ id: String(id), author: { id: 'u', bot: false }, guild: { id: 'g' }, channel: w.channel(channelId), ...over });
    // Runs the clock up to `until`, letting every promise settle between events.
    w.run = async (until) => {
      for (;;) {
        await new Promise((resolve) => setImmediate(resolve));
        const due = [...timers.filter((x) => x.live).map((x) => ({ ...x, kind: 't', ref: x })), ...sleepers.map((x) => ({ ...x, kind: 's', ref: x }))].filter((x) => x.at <= until).sort((a, b) => a.at - b.at || a.n - b.n)[0];
        if (!due) { t = Math.max(t, until); return; }
        t = Math.max(t, due.at);
        if (due.kind === 't') { due.ref.live = false; due.ref.fn(); } else { sleepers.splice(sleepers.indexOf(due.ref), 1); due.ref.resolve(); }
      }
    };
    w.at = async (ms, fn) => { await w.run(ms); await fn(); };
    return w;
  }

  // One message: back at the bottom well under 600 ms, nothing fetched, the old one deleted after the new one.
  {
    const w = world();
    w.reposter.schedule(w.message(100));
    await w.run(5000);
    assert.equal(w.sent.length, 1); assert.equal(w.sent[0].at, 350 + 120, 'quiet time plus the send, nothing else');
    assert.ok(w.sent[0].at < 600, `one message is back in ${w.sent[0].at} ms`); assert.ok(w.sent[0].at < 3000, 'not the old 3 s wait');
    assert.deepEqual(w.timeline, [`send:${w.sent[0].id}`, 'delete:5'], 'send first, delete after'); assert.equal(w.deleted[0].at, 350 + 120 + 80);
    assert.deepEqual(w.saved, [w.sent[0].id]); assert.equal(w.reposter.pending(), 0, 'no state is kept for an idle channel');
    console.log(`  one message: the sticky is back after ${w.sent[0].at} ms (old flow: 3000 ms of waiting plus fetch, delete, send)`);
  }

  // A burst of 20 messages in 3 seconds: at most 2 reposts, the sticky is the last message.
  {
    const w = world();
    const allIds = [];
    for (let i = 0; i < 20; i += 1) {
      const id = w.mid(i * 150); allIds.push(id);
      await w.run(i * 150);
      w.reposter.schedule(w.message(id));
    }
    await w.run(10_000);
    assert.ok(w.sent.length <= 2 && w.sent.length >= 1, `a burst of 20 in 3 s made ${w.sent.length} reposts`);
    assert.equal(w.sent.length, 2, 'the long burst is cut at the maximum wait and the rest is one more pass');
    assert.ok(w.sent[0].at <= 2000 + 120, `the first repost does not wait past the maximum (${w.sent[0].at} ms)`);
    // 20 messages in 2850 ms: the last message was posted at 2850 and the sticky after it.
    assert.ok(w.sent[1].at > 2850, 'the sticky ends below the last message');
    assert.equal(w.row.message_id, w.lastSent); assert.deepEqual(w.deleted.map((d) => d.id), ['5', w.sent[0].id], 'one live sticky at the end, none duplicated');
    console.log(`  burst of 20 in 3 s: ${w.sent.length} reposts, at ${w.sent.map((x) => x.at).join(' and ')} ms`);
  }

  // A message that arrives while the sticky is being sent: one follow-up pass puts it below, nothing is duplicated.
  {
    const w = world({ sendMs: 200 });
    w.reposter.schedule(w.message(100));
    await w.run(500); // the send started at 350 and is in flight; the sticky gets its id at 450
    w.reposter.schedule(w.message(w.mid(500))); // newer than the sticky that is being sent
    await w.run(10_000);
    assert.equal(w.sent.length, 2, 'a follow-up pass');
    assert.ok(w.sent[1].at > w.sent[0].at, 'the second sticky is posted after the first');
    assert.deepEqual(w.timeline.filter((x) => x.startsWith('delete')), ['delete:5', `delete:${w.sent[0].id}`], 'each sticky is deleted once, the live one is the last');
    assert.equal(w.row.message_id, w.sent[1].id);
  }
  // A message that arrives while sending but is OLDER than the sticky (it is above it already) needs no second pass.
  {
    const w = world({ sendMs: 200 });
    w.reposter.schedule(w.message(100));
    await w.run(400);
    w.reposter.schedule(w.message(w.mid(400))); // posted before the sticky got its id: it is above it
    await w.run(10_000);
    assert.equal(w.sent.length, 1, 'a message that is above the sticky does not move it again');
  }

  // A deleted old sticky (10008), a missing channel and a missing permission do not throw.
  {
    const gone = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const w = world({ hooks: { deleteError: () => gone } });
    w.reposter.schedule(w.message(100)); await w.run(5000);
    assert.equal(w.sent.length, 1); assert.deepEqual(w.saved, [w.sent[0].id]); assert.deepEqual(w.errors, []); assert.deepEqual(w.warns, [], 'an already deleted old sticky is expected');
    const lost = world({ hooks: { sendError: () => Object.assign(new Error('Unknown Channel'), { code: 10003 }) } });
    lost.reposter.schedule(lost.message(100)); await lost.run(5000);
    assert.deepEqual(lost.errors, [], 'a channel that is gone is not an error'); assert.deepEqual(lost.deleted, [], 'the old sticky stays when the new one could not be sent'); assert.equal(lost.reposter.pending(), 0);
    const hidden = world({ hooks: { sendError: () => Object.assign(new Error('Missing Permissions'), { code: 50013 }) } });
    hidden.reposter.schedule(hidden.message(100)); await hidden.run(5000); assert.deepEqual(hidden.errors, []);
    const noPerm = world(); const ch = noPerm.channel(); ch.permissionsFor = () => ({ has: () => false });
    noPerm.reposter.schedule(noPerm.message(100, 'c', { guild: { id: 'g', members: { me: {} } } })); await noPerm.run(5000); assert.equal(noPerm.sent.length, 0, 'no permission, no request');
    const off = world({ stickyRow: null }); off.reposter.schedule(off.message(100)); await off.run(5000); assert.equal(off.sent.length, 0, 'a sticky turned off while waiting is not posted');
    const odd = world({ hooks: { sendError: () => new Error('boom') } });
    odd.reposter.schedule(odd.message(100)); await odd.run(5000); assert.equal(odd.errors.length, 1, 'an unexpected error is logged once, with no retry loop'); assert.equal(odd.sent.length, 0);
  }

  // The database failing to save the new id does not leave a duplicate: the next pass deletes the sticky it posted itself.
  {
    const w = world();
    let fail = true; const original = w.row;
    w.reposter = createStickyReposter({
      getSticky: async () => original, setMessageId: async () => { if (fail) throw new Error('db down'); },
      buildPayload: async () => ({ content: 'x' }), logger: { warn() {}, error: (m) => w.errors.push(m) }, quietMs: 350, maxWaitMs: 2000,
      now: () => w.t(), setTimer: (fn, ms) => setTimeout(fn, 0 * ms), clearTimer: clearTimeout,
    });
    const ch = w.channel(); const message = w.message(100);
    let id = 7000; ch.send = async () => ({ id: String(id += 10) }); const removed = []; ch.messages.delete = async (m) => { removed.push(m); };
    w.reposter.schedule(message); await new Promise((r) => setTimeout(r, 20)); fail = false; w.reposter.schedule(w.message(7011)); await new Promise((r) => setTimeout(r, 20));
    assert.ok(removed.includes('7010'), 'the second pass removes the sticky whose id was never saved'); assert.equal(removed[0], '5');
    assert.equal(w.errors.length, 1);
  }

  // Two channels do not block each other: a slow one does not delay the other.
  {
    const w = world();
    const slow = w.channel('slow'); const realSend = slow.send;
    slow.send = async (payload) => { await new Promise((resolve) => { w.release = resolve; }); return realSend(payload); };
    w.reposter.schedule(w.message(100, 'slow')); w.reposter.schedule(w.message(101, 'fast'));
    await w.run(1000);
    assert.equal(w.sent.length, 1, 'the fast channel was reposted while the other waits'); assert.equal(w.sent[0].at, 470);
    assert.equal(w.reposter.pending(), 1, 'the blocked channel is the only one with state');
    w.release(); await w.run(5000); assert.equal(w.sent.length, 2); assert.equal(w.reposter.pending(), 0);
  }

  // The sticky and bots do not start a loop: the sticky's own id is ignored, and a bot never reaches the reposter.
  {
    const w = world();
    w.reposter.schedule(w.message(100)); await w.run(1000);
    const own = w.message(w.lastSent); assert.equal(w.reposter.isOwn(own), true); assert.equal(w.reposter.isOwn(w.message(100)), false);
    await event.execute(post({ id: '20', author: { id: 'b', bot: true } })); // goes through the event: a bot
  }

  // Rate limits: a 429 waits what Discord asks and tries again, up to two times, then gives up with one error.
  {
    assert.equal(rateLimitWaitMs(new Error('x')), null); assert.equal(rateLimitWaitMs({ status: 429, retryAfter: 1.5 }), 1500); assert.equal(rateLimitWaitMs({ status: 429, data: { retry_after: 99 } }), 10_000);
    let calls = 0;
    const w = world({ hooks: { sendError: () => (++calls <= 1 ? Object.assign(new Error('limited'), { status: 429, retryAfter: 2 }) : null) } });
    w.reposter.schedule(w.message(100)); await w.run(20_000);
    assert.equal(calls, 2); assert.equal(w.sent.length, 1); assert.ok(w.sent[0].at >= 350 + 120 + 2000, `the retry waited for the 2 s that Discord asked (${w.sent[0].at} ms)`); assert.deepEqual(w.errors, []);
    let always = 0;
    const stuck = world({ hooks: { sendError: () => { always += 1; return Object.assign(new Error('limited'), { status: 429, retryAfter: 1 }); } } });
    stuck.reposter.schedule(stuck.message(100)); await stuck.run(60_000);
    assert.equal(always, 3, 'one try and two retries'); assert.equal(stuck.errors.length, 1); assert.equal(stuck.reposter.pending(), 0);
  }

  // A long conversation (a message every 200 ms for 10 s) still gets the sticky about every 2 seconds, not never.
  {
    const w = world();
    for (let i = 0; i < 50; i += 1) { await w.run(i * 200); w.reposter.schedule(w.message(w.mid(i * 200))); }
    await w.run(30_000);
    assert.ok(w.sent.length >= 4 && w.sent.length <= 7, `${w.sent.length} reposts in 10 s of constant talk`);
    assert.ok(w.sent.every((s, n) => n === 0 || s.at - w.sent[n - 1].at >= 1500), 'no more than about one repost per 2 s');
  }
  void Collection;
  console.log('Checked the sticky messages: text, saved embeds, V2 designs, the fallback, the repost flow and its timings.');
})().catch((error) => { console.error(error); process.exit(1); });

// YouTube push (WebSub, also called PubSubHubbub), the way the big bots follow YouTube: instead of asking every channel every few minutes, the bot asks YouTube's hub to
// tell it when a channel publishes. The hub calls `/webhooks/youtube` with the new entry (signed with a secret of that channel), the engine looks at that channel at
// once, and the new video or stream is posted within seconds, with no quota spent on asking. A subscription lasts a few days and is renewed a day before it ends.
//
// Push is an accelerator, not the only road: a channel is still looked at now and then (see `intervalFor` in providers/youtube.js), and when push does not work (no public
// address, the hub is down, a subscription ran out) the channels are looked at every 5 minutes as before. So nothing is lost when this part fails.
const crypto = require('crypto');
const config = require('../config');
const store = require('../db/youtubeWebsub');
const feedsDb = require('../db/feeds');
const logger = require('../utils/logger');
const { USER_AGENT } = require('../utils/integrations');
const { forEachWithConcurrency } = require('../utils/concurrency');

const HUB = 'https://pubsubhubbub.appspot.com/subscribe';
const TOPIC = (channelId) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
const LEASE_SECONDS = 5 * 24 * 3600;
const RENEW_BEFORE_MS = 24 * 3_600_000;
const RETRY_BASE_MS = 15 * 60_000;
const PER_RUN = 250; // subscriptions asked in one pass (ten thousand channels are all asked for in about an hour); a hub is not a place to flood
const ASK_WORKERS = 5;
const CHANNEL_ID = /^UC[\w-]{22}$/;

/** channelId -> { status, expiresAt, secret, fails, requestedAt }: what the database says, kept in memory (the push handler reads it on every call). */
const known = new Map();
let wake = () => {}; // set by the job: looks at a channel at once

const enabled = () => Boolean(config.youtubeWebsub && config.youtubeApiKey && baseUrl());
const baseUrl = () => config.youtubeWebsubUrl || String(config.verifyBaseUrl ?? '').replace(/\/+$/, '') || null;
const callbackUrl = () => `${baseUrl()}/webhooks/youtube`;

const remember = (row) => known.set(row.channel_id, { status: row.status, expiresAt: row.expires_at ? Date.parse(row.expires_at) : 0, secret: row.secret, fails: row.fails ?? 0, requestedAt: row.requested_at ? Date.parse(row.requested_at) : 0 });

async function load() {
  known.clear();
  for (const row of await store.listAll()) remember(row);
}

/** Does YouTube push this channel to the bot right now? (a confirmed subscription that has not run out) */
function isHealthy(channelId, now = Date.now()) {
  const entry = known.get(channelId);
  return Boolean(entry && entry.status === 'active' && entry.expiresAt > now);
}

/** The signature YouTube puts on what it sends: sha1 HMAC of the body with the secret of the channel. */
const sign = (secret, body) => `sha1=${crypto.createHmac('sha1', secret).update(body).digest('hex')}`;
function signatureOk(secret, body, header) {
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(String(header ?? ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Asks the hub to subscribe to a channel. The hub answers 202 and then calls the callback (GET) to confirm it. */
async function subscribe(channelId, now = Date.now()) {
  const secret = await store.savePending(channelId, crypto.randomBytes(24).toString('hex'), now);
  const form = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.topic': TOPIC(channelId), 'hub.callback': callbackUrl(), 'hub.verify': 'async', 'hub.secret': secret, 'hub.lease_seconds': String(LEASE_SECONDS) });
  const entry = known.get(channelId);
  remember({ channel_id: channelId, secret, status: entry?.status === 'active' ? 'active' : 'pending', expires_at: entry?.expiresAt ? new Date(entry.expiresAt).toISOString() : null, fails: entry?.fails ?? 0, requested_at: new Date(now).toISOString() });
  try {
    const response = await globalThis.fetch(HUB, { method: 'POST', body: form, headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000) });
    if (response.status >= 200 && response.status < 300) return true;
    throw new Error(`the hub answered ${response.status}`); // i18n-ignore: internal detail for the log
  } catch (error) {
    await store.markFailed(channelId).catch(() => {});
    const current = known.get(channelId); if (current) current.fails += 1;
    logger.warn(`YouTube push: could not ask for ${channelId}: ${error.message}`);
    return false;
  }
}

/** Which channels need a subscription asked for now: new ones, ones that never got confirmed (after a wait that grows with each failure) and ones that end within a day. */
function needing(channelIds, now = Date.now()) {
  return channelIds.filter((id) => {
    const entry = known.get(id);
    if (!entry) return true;
    if (entry.status === 'active' && entry.expiresAt - now > RENEW_BEFORE_MS) return false;
    return now - entry.requestedAt > RETRY_BASE_MS * (1 + Math.min(entry.fails, 8));
  });
}

/** One pass of the upkeep: subscribes the channels that need it (a few at a time) and forgets the ones nobody follows. Returns { followed, healthy, asked }. */
async function maintain({ now = Date.now() } = {}) {
  if (!enabled()) return { followed: 0, healthy: 0, asked: 0 };
  const channelIds = [...new Set((await feedsDb.listEnabled({ now })).filter((feed) => feed.platform === 'youtube' && CHANNEL_ID.test(feed.account_id)).map((feed) => feed.account_id))];
  let asked = 0;
  const due = needing(channelIds, now).slice(0, PER_RUN);
  await forEachWithConcurrency(due, async (id) => { await subscribe(id, now); asked += 1; }, ASK_WORKERS);
  await store.removeExcept(channelIds).catch(() => {});
  return { followed: channelIds.length, healthy: channelIds.filter((id) => isHealthy(id, now)).length, asked };
}

/** The challenge goes back as bytes of plain text, with the type fixed so a browser never reads it as HTML. */
function answerChallenge(res, challenge) {
  res.status(200).set({ 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }).end(Buffer.from(challenge, 'utf8')); // i18n-ignore: a header for a machine
}

/** The hub confirms a subscription (GET with `hub.challenge`): it is answered only for a channel that was asked for. */
async function verifyHandler(req, res) {
  const mode = String(req.query['hub.mode'] ?? '');
  const topic = String(req.query['hub.topic'] ?? '');
  // The challenge is a random string the hub makes up: only letters, digits and a few signs are accepted, and it is sent back as plain bytes that cannot be taken for a page.
  const challenge = /^[\w.~-]{1,200}$/.exec(String(req.query['hub.challenge'] ?? ''))?.[0] ?? '';
  const channelId = /channel_id=(UC[\w-]{22})$/.exec(topic)?.[1];
  const entry = channelId ? known.get(channelId) : null;
  if (!challenge || !channelId || !entry || topic !== TOPIC(channelId)) { res.status(404).send('not found'); return; } // i18n-ignore: an answer to a machine
  if (mode === 'subscribe') {
    const lease = Math.min(Number(req.query['hub.lease_seconds']) || LEASE_SECONDS, 10 * 24 * 3600);
    const expiresAt = Date.now() + lease * 1000;
    await store.markVerified(channelId, expiresAt);
    entry.status = 'active'; entry.expiresAt = expiresAt; entry.fails = 0;
    answerChallenge(res, challenge);
    return;
  }
  if (mode === 'unsubscribe') { answerChallenge(res, challenge); return; }
  res.status(404).send('not found'); // i18n-ignore: an answer to a machine
}

/** The channel ids named in what the hub sends (new or updated entries; a deleted one has no `yt:channelId`). */
const channelsOf = (xml) => [...new Set([...String(xml).matchAll(/<yt:channelId>(UC[\w-]{22})<\/yt:channelId>/g)].map((match) => match[1]))];

/** The hub sends a new or changed entry (POST, signed): the channel is looked at at once, and again a little later (the feed of the channel can take a minute to show it). */
async function pushHandler(req, res) {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));
  res.status(204).end(); // the hub only needs to know it arrived: anything else it is told, it would send again
  try {
    for (const channelId of channelsOf(body.toString('utf8'))) {
      const entry = known.get(channelId);
      if (!entry || !signatureOk(entry.secret, body, req.get('x-hub-signature'))) continue; // not asked for, or not signed with its secret: ignored
      await store.markPush(channelId).catch(() => {});
      entry.lastPushAt = Date.now();
      wake(channelId);
      // The feed of a channel can take many minutes to show a new video, so the channel is looked at again several times after the push.
      for (const delay of [90_000, 300_000, 600_000, 1_200_000]) setTimeout(() => wake(channelId), delay).unref?.();
    }
  } catch (error) {
    logger.warn(`YouTube push: a notice could not be handled: ${error.message}`);
  }
}

const setWake = (fn) => { wake = fn; };

module.exports = { enabled, load, isHealthy, maintain, subscribe, needing, verifyHandler, pushHandler, setWake, sign, signatureOk, channelsOf, callbackUrl, known, TOPIC, LEASE_SECONDS };

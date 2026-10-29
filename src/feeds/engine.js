// The job of the feeds. Every minute it looks at which accounts are due (each platform has its own pace), asks each platform ONCE for all of
// them (the same account followed by many servers is one request), posts what is new in each feed's channel, and edits the message of a
// stream when it ends. What was posted is remembered in `feed_seen`, so a restart posts nothing twice.
const feedsDb = require('../db/feeds');
const { PROVIDERS, noteLate } = require('./providers');
const { buildFeedMessage, buildFeedPayload } = require('./card');
const { channelProblem } = require('./service');
const { fallbackPicture } = require('./platforms');
const { forEachWithConcurrency } = require('../utils/concurrency');
const { peekGuildLanguage, t } = require('../i18n');
const logger = require('../utils/logger');

const MAX_PER_PASS = 3; // after a long silence (or a first look) only the newest are posted; the rest are marked as seen
const SEND_WORKERS = 6;
const FAILURES_TO_STOP = 5;
const MAX_BACKOFF_MS = 30 * 60_000;
// The feeds that post at their own pace (pictures, animals, a song, the Pokémon of the day...) have a new item in each slot of time and no account that can be gone:
// they are asked again soon after a failure, never after half an hour (that was many slots with nothing posted).
const AUTO_BACKOFF_MS = 2 * 60_000;
const POLL_LIMIT_MS = 90_000; // a look that takes longer is given up, so one stuck service never holds back every feed
const KICK_PICTURE = () => fallbackPicture('kick-live');
let kickRepaired = false; // the notices of Kick that are open are repaired once, at the first pass after the bot starts
const schedule = new Map(); // `${platform}:${accountId}` -> { at, fails }

const keyOf = (platform, accountId) => `${platform}:${accountId}`;

/** Does a notice pass the words the feed wants and the ones it does not? */
function passes(feed, item) {
  const text = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase();
  const include = feed.filters?.include ?? [];
  const exclude = feed.filters?.exclude ?? [];
  if (include.length && !include.some((word) => text.includes(word))) return false;
  return !exclude.some((word) => text.includes(word));
}

async function recordSuccess(feed) {
  await feedsDb.update(feed.guild_id, feed.id, { last_sent_at: new Date().toISOString(), failures: 0, last_error: null, last_error_at: null });
}

/** A failure to post: it is written down, and a feed that has failed five times in a row is turned off so it stops trying for ever. */
async function recordFailure(feed, kind) {
  const failures = (feed.failures ?? 0) + 1;
  feed.failures = failures;
  const patch = { failures, last_error: kind, last_error_at: new Date().toISOString() };
  if (failures >= FAILURES_TO_STOP) patch.enabled = false;
  await feedsDb.update(feed.guild_id, feed.id, patch).catch((error) => logger.warn(`Feed ${feed.id}: could not write its failure: ${error.message}`));
}

const POLL_ERROR_AFTER = 3; // failed looks in a row (each one later than the last) before the feed shows the error
// What a failed look at an account is shown as: the feed is not a feed (a web page), the site asks to slow down, or anything else.
const POLL_ERRORS = new Set(['noFeed', 'rateLimited', 'unavailable']);
const pollErrorOf = (kind) => (POLL_ERRORS.has(kind) ? kind : 'unavailable');

async function notePollError(feeds, kind, now) {
  const label = pollErrorOf(kind);
  for (const feed of feeds) {
    if (feed.last_error === label) continue;
    feed.last_error = label;
    await feedsDb.update(feed.guild_id, feed.id, { last_error: label, last_error_at: new Date(now).toISOString() }).catch((error) => logger.warn(`Feed ${feed.id}: could not write its error: ${error.message}`));
  }
}

/** A look that worked again takes away the error of the looks that failed (the errors of posting stay until something is posted). */
async function clearPollError(feeds) {
  for (const feed of feeds) {
    if (!POLL_ERRORS.has(feed.last_error)) continue;
    feed.last_error = null;
    await feedsDb.update(feed.guild_id, feed.id, { last_error: null, last_error_at: null }).catch(() => {});
  }
}

/** The replay of a stream: YouTube keeps it at the same link; Kick gives no link to a single replay, so it is the list of videos of the channel. */
function replayUrl(item) {
  if (item.platform === 'youtube') return item.url;
  if (item.vodUrl) return item.vodUrl;
  return item.platform === 'kick' && item.authorUrl ? `${String(item.authorUrl).replace(/\/+$/, '')}/videos` : null;
}

/** What a stream looks like when it is over: the same card, in the same color, with its two buttons and the most viewers it had (no platform gives the total of a stream). */
function endedItem(item, lang) {
  const extra = String(item.extra ?? '').split(' · ').filter((part) => part && !part.startsWith('👁'));
  if (item.peak > 0) extra.push(`👁 ${t(lang, 'feeds.ended.peak', { count: item.peak.toLocaleString('en-US') })}`);
  const ended = { ...item, type: 'ended', vodUrl: replayUrl(item), extra: extra.join(' · ') };
  if (item.platform === 'kick') ended.image = KICK_PICTURE(); // the preview of a Kick stream can be a broken picture in Discord (see `repairKickPictures`)
  return ended;
}

async function closeLive(client, feed, row, lang) {
  const channel = client.channels.cache.get(row.channel_id) ?? await client.channels.fetch(row.channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (message) {
    const payload = buildFeedMessage(feed, endedItem(row.item, lang), { lang });
    await message.edit({ ...payload, allowedMentions: { parse: [] } }).catch((error) => logger.warn(`Feed ${feed.id}: could not close its live message: ${error.message}`));
  }
  await feedsDb.deleteLive(feed.id, row.item_id);
}

const LATE_LIVE_MS = 150_000;
const lateLogged = new Set();
/** A stream that started a while before its notice went out: said once (in the log), so a slow platform is told apart from a slow bot. */
function noteLateLive(feed, item, now) {
  if (now - item.publishedAt < LATE_LIVE_MS || lateLogged.has(`${item.platform}:${item.id}`)) return;
  if (lateLogged.size > 500) lateLogged.clear();
  lateLogged.add(`${item.platform}:${item.id}`);
  // i18n-ignore: a line of the log
  logger.info(`Feeds: the ${item.platform} stream of ${item.author} started ${Math.round((now - item.publishedAt) / 60_000)} min before its notice went out (the bot asks every minute; the rest is the platform taking time to say it is live).`);
}

/** Posts the new notices of one feed (and closes its streams that ended). */
async function processFeed(client, feed, result, liveRows, seen, now) {
  const guild = client.guilds.cache.get(feed.guild_id);
  if (!guild) return; // Petto is not in that server (now): nothing to post, and nothing is lost
  const lang = peekGuildLanguage(guild.id);

  // A feed whose first look failed has not marked what already existed: this pass only marks it.
  if (!feed.ready) {
    await feedsDb.markSeen(result.items.map((item) => [feed.id, String(item.id)]));
    await feedsDb.update(feed.guild_id, feed.id, { ready: true });
    feed.ready = true;
    return;
  }

  const wanted = new Set(feed.types ?? []);
  if (feed.platform === 'modrinth' && String(feed.account_id).startsWith('new:')) wanted.add('project'); // a list of the newest projects (made before that kind of notice existed) posts them
  const unseen = result.items.filter((item) => !seen.has(`${feed.id}:${item.id}`));
  const toPost = unseen.filter((item) => wanted.has(item.type) && passes(feed, item)).sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0)).slice(-MAX_PER_PASS);

  let posted = 0;
  if (toPost.length) {
    const channel = guild.channels.cache.get(feed.channel_id);
    const problem = channelProblem(guild, channel);
    if (problem) {
      await recordFailure(feed, problem === 'permission' ? 'permission' : 'channelGone');
    } else {
      for (const item of toPost) {
        try {
          const message = await channel.send(await buildFeedPayload(feed, item, { lang }));
          posted += 1;
          if (feed.platform === 'youtube' && (item.type === 'video' || item.type === 'short')) noteLate(feed.account_id, item);
          if (item.type === 'live' && item.publishedAt) noteLateLive(feed, item, now);
          if (item.type === 'live') await feedsDb.saveLive({ feed_id: feed.id, item_id: String(item.id), channel_id: channel.id, message_id: message.id, item });
        } catch (error) {
          await recordFailure(feed, error?.code === 10003 ? 'channelGone' : error?.code === 50001 || error?.code === 50013 ? 'permission' : 'send');
          break;
        }
      }
      if (posted) await recordSuccess(feed).catch(() => {});
    }
  }
  // Everything that was seen now is remembered, also what the feed does not post (a type it did not choose), so turning it on later is not a flood.
  if (unseen.length) await feedsDb.markSeen(unseen.map((item) => [feed.id, String(item.id)]));

  if (result.stillLive) {
    for (const row of liveRows.get(feed.id) ?? []) if (!result.stillLive.has(row.item_id)) await closeLive(client, feed, row, lang);
  }
  // The most viewers a stream had is kept (written down only when it grows), for the card that closes it.
  for (const row of liveRows.get(feed.id) ?? []) {
    const viewers = result.items.find((item) => String(item.id) === row.item_id)?.viewers;
    if (!(viewers > (row.item?.peak ?? 0))) continue;
    row.item = { ...row.item, peak: viewers };
    await feedsDb.saveLive({ feed_id: feed.id, item_id: row.item_id, channel_id: row.channel_id, message_id: row.message_id, item: row.item }).catch(() => {});
  }
  // A live notice that went out with a stand-in picture (the stream's own was not made yet) gets the real one as soon as it exists.
  for (const row of liveRows.get(feed.id) ?? []) {
    if (!row.item?.placeholder) continue;
    const current = result.items.find((item) => String(item.id) === row.item_id);
    if (!current || current.placeholder) continue;
    const channel = client.channels.cache.get(row.channel_id) ?? await client.channels.fetch(row.channel_id).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    if (message) await message.edit({ ...buildFeedMessage(feed, current, { lang }), allowedMentions: { parse: [] } }).catch((error) => logger.warn(`Feed ${feed.id}: could not update the picture of its live message: ${error.message}`));
    const kept = { ...current, peak: row.item.peak };
    await feedsDb.saveLive({ feed_id: feed.id, item_id: row.item_id, channel_id: row.channel_id, message_id: row.message_id, item: kept }).catch(() => {});
    row.item = kept; // once is enough
  }
}

/**
 * The live notices of Kick that were posted with its preview (before a Kick notice always carried the picture of Kick) may show a broken picture that never
 * fixes itself: they are edited once, when the bot starts, to carry the picture of Kick. Returns how many were edited.
 */
async function repairKickPictures(client, feeds, liveByFeed) {
  let repaired = 0;
  for (const feed of feeds) {
    if (feed.platform !== 'kick') continue;
    for (const row of liveByFeed.get(feed.id) ?? []) {
      if (!row.item || row.item.image === KICK_PICTURE()) continue;
      const item = { ...row.item, image: KICK_PICTURE(), placeholder: undefined };
      try {
        const channel = client.channels.cache.get(row.channel_id) ?? await client.channels.fetch(row.channel_id).catch(() => null);
        const message = channel?.messages ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
        if (message) await message.edit({ ...buildFeedMessage(feed, item, { lang: peekGuildLanguage(feed.guild_id) }), allowedMentions: { parse: [] } });
        await feedsDb.saveLive({ feed_id: feed.id, item_id: row.item_id, channel_id: row.channel_id, message_id: row.message_id, item });
        row.item = item;
        repaired += 1;
      } catch (error) {
        logger.warn(`Feed ${feed.id}: could not repair the picture of a Kick notice: ${error.message}`);
      }
    }
  }
  if (repaired) logger.info(`Feeds: ${repaired} live notice(s) of Kick got the picture of Kick back.`);
  return repaired;
}

/**
 * One pass of the job. `client` is the discord.js client. Returns the number of accounts asked about (for the checks).
 * `passMs`: how often the job makes a pass; the `perTick` of a provider is what it can be asked in a minute, so a shorter pass takes a smaller share of it.
 */
async function tick(client, { now = Date.now(), providers = PROVIDERS, passMs = 60_000 } = {}) {
  const feeds = await feedsDb.listEnabled({ now });
  if (!feeds.length) return 0;
  const liveByFeed = new Map();
  for (const row of await feedsDb.liveRowsAll()) {
    if (!liveByFeed.has(row.feed_id)) liveByFeed.set(row.feed_id, []);
    liveByFeed.get(row.feed_id).push(row);
  }

  if (!kickRepaired) { kickRepaired = true; await repairKickPictures(client, feeds, liveByFeed); }

  const byPlatform = new Map();
  for (const feed of feeds) {
    if (!providers[feed.platform]) continue;
    if (!byPlatform.has(feed.platform)) byPlatform.set(feed.platform, new Map());
    const accounts = byPlatform.get(feed.platform);
    if (!accounts.has(feed.account_id)) accounts.set(feed.account_id, []);
    accounts.get(feed.account_id).push(feed);
  }

  let asked = 0;
  for (const [platform, accounts] of byPlatform) {
    const provider = providers[platform];
    const backoffCap = provider.noAccount ? AUTO_BACKOFF_MS : MAX_BACKOFF_MS;
    const due = [...accounts.entries()].filter(([id]) => (schedule.get(keyOf(platform, id))?.at ?? 0) <= now).slice(0, Math.max(1, Math.ceil(provider.perTick * Math.min(1, passMs / 60_000))));
    if (!due.length) continue;
    asked += due.length;

    const tracked = new Map();
    for (const [id, list] of due) {
      const ids = new Set();
      for (const feed of list) for (const row of liveByFeed.get(feed.id) ?? []) ids.add(row.item_id);
      if (ids.size) tracked.set(id, ids);
    }
    const accountOf = (id, list) => ({ id, name: list[0].account_name, avatar: list[0].account_avatar, url: list[0].account_url });

    // Some platforms answer in the language of the reader (the Pokémon's entry, the article of Wikipedia): one question for each language in use.
    const languages = provider.perLanguage ? [...new Set(due.flatMap(([, list]) => list.map((feed) => peekGuildLanguage(feed.guild_id))))] : [null];
    for (const lang of languages) {
      let results;
      try {
        let timer;
        const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`it took more than ${POLL_LIMIT_MS / 1000} seconds`)), POLL_LIMIT_MS); }); // i18n-ignore: the reason shown in a log line
        try {
          results = await Promise.race([provider.poll(due.map(([id, list]) => accountOf(id, list)), tracked, { now, lang: lang ?? 'en' }), limit]);
        } finally { clearTimeout(timer); }
      } catch (error) {
        logger.warn(`Feeds: ${platform} could not be asked: ${error.message}`);
        for (const [id] of due) schedule.set(keyOf(platform, id), { at: now + Math.min(backoffCap, provider.interval * 2), fails: (schedule.get(keyOf(platform, id))?.fails ?? 0) + 1 });
        continue;
      }

      const itemIds = [...new Set([...results.values()].flatMap((result) => result.items.map((item) => String(item.id))))];
      const forLang = (feed) => lang === null || peekGuildLanguage(feed.guild_id) === lang;
      const seen = await feedsDb.seenAmong(due.flatMap(([, list]) => list.filter(forLang).map((feed) => feed.id)), itemIds);

      for (const [id, list] of due) {
        const result = results.get(id) ?? { items: [] };
        const previous = schedule.get(keyOf(platform, id))?.fails ?? 0;
        if (result.error) {
          schedule.set(keyOf(platform, id), { at: now + Math.min(backoffCap, provider.interval * 2 ** Math.min(previous + 1, 5)), fails: previous + 1 });
          if (result.error === 'notFound' && previous + 1 >= 6) for (const feed of list) await recordFailure(feed, 'accountGone');
          // An account that cannot be read time after time is shown in the list of feeds (`!feed list`, the dashboard) with why, instead of
          // staying "on" and silent. It is not turned off: it posts again by itself when the account answers.
          else if (previous + 1 >= POLL_ERROR_AFTER) await notePollError(list, result.error, now);
          continue;
        }
        await clearPollError(list);
        schedule.set(keyOf(platform, id), { at: now + (provider.intervalFor?.(id, now) ?? provider.interval) + Math.floor(Math.random() * 15_000), fails: 0 });
        await forEachWithConcurrency(list.filter(forLang), (feed) => processFeed(client, feed, result, liveByFeed, seen, now).catch((error) => logger.error(`Feed ${feed.id} failed:`, error)), SEND_WORKERS);
      }
    }
  }
  return asked;
}

/** Makes an account due at the next pass (YouTube told the bot something new is there): it is looked at at once instead of when its turn comes. */
const wake = (platform, accountId) => { schedule.set(keyOf(platform, accountId), { at: 0, fails: 0 }); };

const forgetSchedule = () => { schedule.clear(); feedsDb.forgetList(); kickRepaired = true; }; // for the checks (the repair is checked by itself)

module.exports = { tick, wake, processFeed, passes, forgetSchedule, replayUrl, repairKickPictures, MAX_PER_PASS, FAILURES_TO_STOP };

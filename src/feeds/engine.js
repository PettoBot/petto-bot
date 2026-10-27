// The job of the feeds. Every minute it looks at which accounts are due (each platform has its own pace), asks each platform ONCE for all of
// them (the same account followed by many servers is one request), posts what is new in each feed's channel, and edits the message of a
// stream when it ends. What was posted is remembered in `feed_seen`, so a restart posts nothing twice.
const feedsDb = require('../db/feeds');
const { PROVIDERS } = require('./providers');
const { buildFeedMessage, buildFeedPayload } = require('./card');
const { channelProblem } = require('./service');
const { forEachWithConcurrency } = require('../utils/concurrency');
const { peekGuildLanguage } = require('../i18n');
const logger = require('../utils/logger');

const MAX_PER_PASS = 3; // after a long silence (or a first look) only the newest are posted; the rest are marked as seen
const SEND_WORKERS = 6;
const FAILURES_TO_STOP = 5;
const MAX_BACKOFF_MS = 30 * 60_000;
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

/** What a stream looks like when it is over: the same card, grey, with its two buttons. */
const endedItem = (item) => ({ ...item, type: 'ended', vodUrl: item.platform === 'youtube' ? item.url : item.vodUrl ?? null });

async function closeLive(client, feed, row, lang) {
  const channel = client.channels.cache.get(row.channel_id) ?? await client.channels.fetch(row.channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (message) {
    const payload = buildFeedMessage(feed, endedItem(row.item), { lang });
    await message.edit({ ...payload, allowedMentions: { parse: [] } }).catch((error) => logger.warn(`Feed ${feed.id}: could not close its live message: ${error.message}`));
  }
  await feedsDb.deleteLive(feed.id, row.item_id);
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
  // A live notice that went out with a stand-in picture (the stream's own was not made yet) gets the real one as soon as it exists.
  for (const row of liveRows.get(feed.id) ?? []) {
    if (!row.item?.placeholder) continue;
    const current = result.items.find((item) => String(item.id) === row.item_id);
    if (!current || current.placeholder) continue;
    const channel = client.channels.cache.get(row.channel_id) ?? await client.channels.fetch(row.channel_id).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    if (message) await message.edit({ ...buildFeedMessage(feed, current, { lang }), allowedMentions: { parse: [] } }).catch((error) => logger.warn(`Feed ${feed.id}: could not update the picture of its live message: ${error.message}`));
    await feedsDb.saveLive({ feed_id: feed.id, item_id: row.item_id, channel_id: row.channel_id, message_id: row.message_id, item: current }).catch(() => {});
    row.item = current; // once is enough
  }
}

/** One pass of the job. `client` is the discord.js client. Returns the number of accounts asked about (for the checks). */
async function tick(client, { now = Date.now(), providers = PROVIDERS } = {}) {
  const feeds = await feedsDb.listEnabled({ now });
  if (!feeds.length) return 0;
  const liveByFeed = new Map();
  for (const row of await feedsDb.liveRowsAll()) {
    if (!liveByFeed.has(row.feed_id)) liveByFeed.set(row.feed_id, []);
    liveByFeed.get(row.feed_id).push(row);
  }

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
    const due = [...accounts.entries()].filter(([id]) => (schedule.get(keyOf(platform, id))?.at ?? 0) <= now).slice(0, provider.perTick);
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
        results = await provider.poll(due.map(([id, list]) => accountOf(id, list)), tracked, { now, lang: lang ?? 'en' });
      } catch (error) {
        logger.warn(`Feeds: ${platform} could not be asked: ${error.message}`);
        for (const [id] of due) schedule.set(keyOf(platform, id), { at: now + Math.min(MAX_BACKOFF_MS, provider.interval * 2), fails: (schedule.get(keyOf(platform, id))?.fails ?? 0) + 1 });
        continue;
      }

      const itemIds = [...new Set([...results.values()].flatMap((result) => result.items.map((item) => String(item.id))))];
      const forLang = (feed) => lang === null || peekGuildLanguage(feed.guild_id) === lang;
      const seen = await feedsDb.seenAmong(due.flatMap(([, list]) => list.filter(forLang).map((feed) => feed.id)), itemIds);

      for (const [id, list] of due) {
        const result = results.get(id) ?? { items: [] };
        const previous = schedule.get(keyOf(platform, id))?.fails ?? 0;
        if (result.error) {
          schedule.set(keyOf(platform, id), { at: now + Math.min(MAX_BACKOFF_MS, provider.interval * 2 ** Math.min(previous + 1, 5)), fails: previous + 1 });
          if (result.error === 'notFound' && previous + 1 >= 6) for (const feed of list) await recordFailure(feed, 'accountGone');
          continue;
        }
        schedule.set(keyOf(platform, id), { at: now + provider.interval + Math.floor(Math.random() * 15_000), fails: 0 });
        await forEachWithConcurrency(list.filter(forLang), (feed) => processFeed(client, feed, result, liveByFeed, seen, now).catch((error) => logger.error(`Feed ${feed.id} failed:`, error)), SEND_WORKERS);
      }
    }
  }
  return asked;
}

const forgetSchedule = () => { schedule.clear(); feedsDb.forgetList(); }; // for the checks

module.exports = { tick, processFeed, passes, forgetSchedule, MAX_PER_PASS, FAILURES_TO_STOP };

// What the engine needs from a platform:
//   interval      how often (ms) an account is asked about
//   perTick       how many accounts at most are asked about in one pass of the job (the rest wait for the next one)
//   concurrency   how many requests at the same time
//   resolve(text)            -> { id, name, avatar, url, extra? } the account a person pointed at (throws IntegrationError)
//   poll(accounts, tracked)  -> Map(accountId -> { items: [item], stillLive?: Set(itemId), error?: kind })
//        `accounts`: [{ id, name, avatar, url }]; `tracked`: Map(accountId -> Set(itemId)) of the streams that have an open message.
//        An item is { platform, type, id, title, url, … } (see card.js); a platform without live streams leaves `stillLive` out.
//   perLanguage / noAccount   (flags) the answer is in the language of each server / the platform has no account to type
//   baselineItems(account)   -> the items that exist now, which a new feed marks as seen so it does not post the past
const { forEachWithConcurrency } = require('../../utils/concurrency');
const youtube = require('./youtube');
const twitch = require('./twitch');
const kick = require('./kick');
const bluesky = require('./bluesky');
const modrinth = require('./modrinth');
const pokemon = require('./pokemon');
const rss = require('./rss');
const github = require('./github');
const packages = require('./packages');
const steam = require('./steam');
const anilist = require('./anilist');
const daily = require('./daily');
const music = require('./music');
const animals = require('./animals');
const pictures = require('./pictures');
const websub = require('../websub');
const redis = require('../../utils/redis');
const logger = require('../../utils/logger');
const social = require('./social');
const epic = require('./epic');
const schedule = require('../schedule');
const { t } = require('../../i18n');
const { IntegrationError } = require('../../utils/integrations');
const { fallbackPicture } = require('../platforms');
const { withStandIn } = require('../picture');

/** The videos that were seen live or about to be: when they end they are a recording of a stream, and are not posted as a new video. */
const wasLive = new Set();
// What the bot has learned about the videos (which ones are not live, which ones were streams, how long each is) is lost when it restarts, and a restart then asks about every
// recent video of every channel again (quota) and could post the recording of a stream that ended as a new video. When there is Redis it is kept there (about a minute behind).
const STATE_KEY = 'feeds:youtube:state';
const STATE_TTL_MS = 3 * 86_400_000;
let stateDirty = false;
let stateSavedAt = 0;
const WAS_LIVE_LIMIT = 20_000;
const rememberLive = (id) => { if (wasLive.size >= WAS_LIVE_LIMIT) wasLive.delete(wasLive.values().next().value); wasLive.add(id); stateDirty = true; };

const HOUR = 3_600_000;
const MAX_AGE_MS = 3 * 24 * HOUR; // an old item that shows up again (a feed that is cleaned up, a long downtime) is not news
const fresh = (item, now) => !item.publishedAt || now - Number(item.publishedAt) <= MAX_AGE_MS;

/** The video ids that are known not to be live (and never will be): asking about them again would only spend quota. */
const notLive = new Set();
const NOT_LIVE_LIMIT = 50_000;
const PUSHED_INTERVAL_MS = 30 * 60_000;
const PUSHED_FEW = 1500; // up to this many followed channels, the ones that are pushed are still looked at every 10 minutes: a push that never arrives costs a few minutes, not half an hour
const PUSHED_VERY_FEW = 300; // and up to this many every 3 minutes (the feed of a channel costs no quota)
const pushedInterval = () => (websub.known.size <= PUSHED_VERY_FEW ? 3 * 60_000 : websub.known.size <= PUSHED_FEW ? 10 * 60_000 : PUSHED_INTERVAL_MS);
const busyChannels = new Map(); // channelId -> true while it has a stream announced or on
const rememberNotLive = (id) => { if (notLive.size >= NOT_LIVE_LIMIT) notLive.delete(notLive.values().next().value); notLive.add(id); stateDirty = true; };

/** Writes the state to Redis when it changed (at most once a minute). */
async function saveYoutubeState(now = Date.now()) {
  if (!stateDirty || now - stateSavedAt < 60_000) return false;
  stateDirty = false; stateSavedAt = now;
  return redis.setJson(STATE_KEY, { notLive: [...notLive].slice(-20_000), wasLive: [...wasLive].slice(-5_000), lengths: youtube.exportLengths(), at: now }, STATE_TTL_MS);
}

/** Reads the state back after a restart. Answers whether there was any. */
async function restoreYoutubeState() {
  await youtube.restoreQuota().catch(() => {});
  const saved = await redis.getJson(STATE_KEY);
  if (!saved.hit || !saved.value) return false;
  for (const id of saved.value.notLive ?? []) if (typeof id === 'string') notLive.add(id);
  for (const id of saved.value.wasLive ?? []) if (typeof id === 'string') wasLive.add(id);
  youtube.importLengths(saved.value.lengths);
  return true;
}

/** A platform whose account has a list of items it reads one by one: the same poll for all of them. `read(account, now)` -> items; failures are told apart. */
const listPoll = (read, concurrency = 3) => async function poll(accounts, _tracked, { now = Date.now() } = {}) {
  const results = new Map();
  await forEachWithConcurrency(accounts, async (account) => {
    try { results.set(account.id, { items: (await read(account, now)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
  }, concurrency);
  return results;
};

/** A cat, a dog, a fox or any of them (`animals`): a picture for each slot of time of the pace of the account (once a day to every 5 minutes), the same for every server of that pace. */
function animalFeed(animal) {
  const mixed = animal === 'animals'; // the one feed of the animals: any of them, or only the ones asked for (`15m cat dog`)
  const names = { cat: 'Cats', dog: 'Dogs', fox: 'Foxes', bird: 'Birds', duck: 'Ducks', capybara: 'Capybaras', bunny: 'Bunnies', animals: 'Animals' }; // i18n-ignore: the name of what is posted
  const keyOf = (account, minutes, slot) => `${minutes}:${slot}${mixed ? animals.suffixOf(animals.kindsOf(account.id)) : ''}`;
  return {
    interval: 60_000, perTick: 5000, concurrency: 1, perLanguage: true, noAccount: true,
    async resolve(text, { lang } = {}) {
      const { tokens, kinds } = mixed ? animals.parseAnimalInput(text) : { tokens: [String(text ?? '')], kinds: [] };
      const minutes = schedule.parseMinutes(tokens.join(' '));
      if (minutes === null) throw new IntegrationError('badInput');
      const suffix = mixed ? animals.suffixOf(kinds) : '';
      const id = suffix ? `every:${minutes}${suffix}` : schedule.accountIdFor(animal, minutes);
      const name = mixed && kinds.length && kinds.length < animals.KINDS.length ? kinds.map((kind) => t(lang, `feeds.animals.name.${kind}`)).join(' + ') : (mixed ? t(lang, 'feeds.animals.name.all') : names[animal]);
      return { id, name, avatar: null, url: null };
    },
    async poll(accounts, _tracked, { now = Date.now(), lang = 'en' } = {}) {
      const results = new Map();
      for (const account of accounts) {
        const minutes = schedule.minutesOf(account.id);
        const slot = schedule.slotOf(now, minutes);
        const key = keyOf(account, minutes, slot);
        const found = await animals.pictureOf(animal, key);
        results.set(account.id, { items: found ? [animals.toItem(animal, found, { id: key, at: schedule.slotStart(slot, minutes), lang })] : [] });
      }
      return results;
    },
    async baselineItems(account, now = Date.now()) {
      const minutes = schedule.minutesOf(account.id);
      return [{ id: keyOf(account, minutes, schedule.slotOf(now, minutes)) }];
    },
  };
}

/** Pictures by tags (`15m pink cat`): a picture for each slot of time of the pace of the account, the same for every server that wrote the same tags and the same pace. */
const picturesFeed = {
  interval: 60_000, perTick: 5000, concurrency: 1, noAccount: true,
  // A word with several meanings (`rosa`: the flower, the color, the mountain) is asked about (`ambiguous`, with the choices) unless the other words say
  // which one; the name of the account is what is searched (`pink · flower · anime style`), so the list of feeds shows it.
  async resolve(text, { lang = 'en' } = {}) {
    const isPace = (word) => /^(?:every:)?\d{1,4}\s*(?:m|min|mins|minutes?|h|hrs?|hours?|d|days?)?$/i.test(word);
    const { tags, ambiguous } = pictures.parseQuery(String(text ?? '').split(/\s+/).filter((word) => !isPace(word)).join(' '));
    if (!tags.length || pictures.refused(tags)) throw new IntegrationError('badTags');
    const pace = String(text ?? '').split(/\s+/).find(isPace) ?? '';
    const minutes = schedule.parseMinutes(pace);
    if (minutes === null) throw new IntegrationError('badInput'); // the pace (what the service turns into the message about the pace)
    if (ambiguous) throw pictures.ambiguousError(String(text ?? '').trim(), ambiguous);
    return { id: `every:${minutes}:${pictures.joinTags(tags)}`, name: pictures.queryLabel(tags, t(lang, 'feeds.pictures.animeStyle')).slice(0, 100), avatar: null, url: null };
  },
  async poll(accounts, _tracked, { now = Date.now() } = {}) {
    const results = new Map();
    for (const account of accounts) {
      const minutes = schedule.minutesOf(account.id);
      const slot = schedule.slotOf(now, minutes);
      try {
        const item = await pictures.pictureOf(pictures.tagsOf(account.id), `${minutes}:${slot}`, schedule.slotStart(slot, minutes));
        results.set(account.id, { items: item ? [item] : [] });
      } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
    }
    return results;
  },
  async baselineItems(account, now = Date.now()) {
    const minutes = schedule.minutesOf(account.id);
    return [{ id: `${minutes}:${schedule.slotOf(now, minutes)}` }];
  },
};

/** A song at random, at the pace of the account (once a day to every 5 minutes), the same for every server of that pace. */
const randomMusicFeed = {
  interval: 60_000, perTick: 5000, concurrency: 1, noAccount: true,
  async resolve(text) {
    const minutes = schedule.parseMinutes(text);
    if (minutes === null) throw new IntegrationError('badInput');
    return { id: schedule.accountIdFor('randommusic', minutes), name: 'Random music', avatar: null, url: null }; // i18n-ignore: the name of what is posted
  },
  async poll(accounts, _tracked, { now = Date.now() } = {}) {
    const results = new Map();
    for (const account of accounts) {
      const minutes = schedule.minutesOf(account.id);
      const slot = schedule.slotOf(now, minutes);
      try {
        const item = await music.randomSong(`${minutes}:${slot}`, schedule.slotStart(slot, minutes));
        results.set(account.id, { items: item ? [item] : [] });
      } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
    }
    return results;
  },
  async baselineItems(account, now = Date.now()) {
    const minutes = schedule.minutesOf(account.id);
    return [{ id: `${minutes}:${schedule.slotOf(now, minutes)}` }];
  },
};

/**
 * A video that is posted long after it was published is said in the log, with whether YouTube pushed it: that tells a late push from one that never came.
 * Called by the engine when a notice is really sent (once for each video, however many servers follow the channel), never for what was only looked at.
 */
const lateNoted = new Set();
function noteLate(channelId, item, now = Date.now()) {
  const published = Number(item.publishedAt);
  if (!Number.isFinite(published) || now - published < 8 * 60_000 || lateNoted.has(item.id)) return;
  if (lateNoted.size > 5000) lateNoted.clear();
  lateNoted.add(item.id);
  const pushedAt = websub.known.get(channelId)?.lastPushAt;
  const push = pushedAt && pushedAt >= published ? `a push arrived ${Math.round((pushedAt - published) / 60_000)} min after it was published` : 'no push arrived for it'; // i18n-ignore: part of a log line for the operator
  logger.info(`YouTube: "${String(item.title ?? item.id).slice(0, 60)}" of ${item.author ?? channelId} reached the notice ${Math.round((now - published) / 60_000)} min after it was published (${push}).`); // i18n-ignore: log line for the operator
}

const PROVIDERS = {
  youtube: {
    interval: 5 * 60_000, perTick: 600, concurrency: 12, // 600 channels a minute: ten thousand pushed channels (a look every 30 minutes) need about 330
    // A channel that YouTube pushes to the bot (see feeds/websub.js) only needs a look now and then, to catch what a push missed; one with a stream announced or on is
    // looked at as often as ever, because the start of a stream is not always pushed.
    intervalFor(channelId, now = Date.now()) { return websub.isHealthy(channelId, now) && !busyChannels.has(channelId) ? pushedInterval() : 5 * 60_000; },
    async resolve(text) {
      const channel = await youtube.resolveChannel(text);
      return { id: channel.id, name: channel.name, avatar: channel.avatar, url: channel.url };
    },
    async poll(accounts, tracked = new Map(), { now = Date.now(), withLive = true } = {}) {
      const results = new Map();
      const entries = new Map(); // accountId -> entries
      await forEachWithConcurrency(accounts, async (account) => {
        try {
          const fromFeed = (await youtube.fetchChannel(account.id)).entries;
          // What YouTube pushed is added to what the feed shows: the feed can take minutes to show a new video, the push does not.
          const known = new Set(fromFeed.map((entry) => entry.videoId));
          entries.set(account.id, [...websub.pushedFor(account.id).filter((entry) => !known.has(entry.videoId)), ...fromFeed]);
        } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);

      // One call (a unit for up to 50 videos) says which new videos are live or about to be, and whether the streams being followed are still on.
      let states = {};
      if (withLive) {
        const ids = new Set();
        // Every entry of the feed that is not known to be a plain video, old ones too: a stream is often scheduled days before it starts, so it is not "new"
        // by the date it was published, and it must be seen the moment it goes live. A video found not to be live is asked about only once.
        for (const list of entries.values()) for (const entry of list) if (!notLive.has(entry.videoId)) ids.add(entry.videoId);
        for (const set of tracked.values()) for (const id of set) ids.add(id);
        try { states = ids.size ? await youtube.liveStates([...ids]) : {}; } catch { states = null; }
        // When it cannot be told whether the videos are live (no key, the call failed), nothing is posted this time: a stream must never go out as a
        // video. Nothing is marked as seen either, so the next pass tries again.
        if (states === null) {
          for (const account of accounts) if (entries.has(account.id)) results.set(account.id, { items: [], error: 'unavailable' });
          return results;
        }
      }

      for (const account of accounts) {
        if (!entries.has(account.id)) continue;
        const items = [];
        const stillLive = new Set();
        for (const entry of entries.get(account.id)) {
          if (!entry.description && states?.[entry.videoId]?.description) entry.description = states[entry.videoId].description;
          const state = states?.[entry.videoId]?.state;
          if (state === 'live') {
            rememberLive(entry.videoId); stillLive.add(entry.videoId);
            // The notice says when the stream began, not when its page was made (a scheduled stream can have been made hours or days before).
            items.push({ ...youtube.toItem(entry, 'live', account), publishedAt: states[entry.videoId].startedAt ?? entry.published });
            continue;
          }
          if (state === 'upcoming') { rememberLive(entry.videoId); continue; } // announced, not started: it is posted when it starts
          if (state === 'none' && wasLive.has(entry.videoId)) { rememberNotLive(entry.videoId); continue; } // a stream that already ended: its recording is not a new video, and it is not asked about again
          if (state === 'none') rememberNotLive(entry.videoId);
          if (fresh({ publishedAt: entry.published }, now)) items.push(youtube.toItem(entry, entry.short ? 'short' : 'video', account));
        }
        for (const id of tracked.get(account.id) ?? []) if (states?.[id]?.state === 'live') stillLive.add(id);
        // A channel with a stream announced or on (or one that cannot be told about) is kept on the fast pace.
        const busy = !states || stillLive.size > 0 || entries.get(account.id).some((entry) => states[entry.videoId]?.state === 'upcoming');
        if (busy) busyChannels.set(account.id, true); else busyChannels.delete(account.id);
        results.set(account.id, { items, ...(states ? { stillLive } : {}) });
      }
      saveYoutubeState(now).catch(() => {});
      return results;
    },
    async baselineItems(account) {
      const { entries } = await youtube.fetchChannel(account.id);
      const states = await youtube.liveStates(entries.map((entry) => entry.videoId)).catch(() => ({}));
      return entries.map((entry) => ({ id: entry.videoId, live: states[entry.videoId]?.state === 'live' }));
    },
  },

  twitch: {
    interval: 60_000, perTick: 5000, concurrency: 1, // 100 accounts in each call: 50 calls a minute at most, far from the limit of Twitch
    async resolve(text) {
      const user = await twitch.resolveUser(text);
      return { id: user.id, name: user.name, avatar: user.avatar, url: user.url };
    },
    async poll(accounts) {
      const live = await twitch.liveStreams(accounts.map((account) => account.id)); // 100 accounts in each call
      const results = new Map();
      // The preview of a stream is made a little after it starts: until it loads the notice carries a picture of Twitch (see picture.js).
      const items = new Map();
      await forEachWithConcurrency(accounts.filter((account) => live[account.id]), async (account) => { items.set(account.id, await withStandIn(twitch.toItem(live[account.id], account), fallbackPicture('twitch-live'))); }, 8);
      for (const account of accounts) {
        const stream = live[account.id];
        results.set(account.id, { items: stream ? [items.get(account.id)] : [], stillLive: new Set(stream ? [stream.id] : []) });
      }
      return results;
    },
    async baselineItems(account) {
      const live = await twitch.liveStreams([account.id]);
      return live[account.id] ? [{ id: live[account.id].id, live: true }] : [];
    },
  },

  kick: {
    interval: 60_000, perTick: 2000, concurrency: 1, // a live notice goes out within a minute or so of the start
    async resolve(text) {
      const channel = await kick.resolveChannel(text);
      return { id: channel.id, name: channel.name, avatar: channel.avatar, url: channel.url };
    },
    async poll(accounts) {
      const live = await kick.liveChannels(accounts.map((account) => account.id)); // 50 accounts in each call
      const results = new Map();
      for (const account of accounts) {
        const channel = live[account.id];
        let item = channel ? kick.toItem(channel, account) : null;
        // The preview of a Kick stream is made a few minutes after it starts, and even when its address answers Discord can fail to draw it (a broken picture
        // that stays), so a Kick notice always carries the picture of Kick and goes out the moment the stream is seen.
        if (item) item = { ...item, image: fallbackPicture('kick-live') };
        results.set(account.id, { items: item ? [item] : [], stillLive: new Set(channel ? [kick.streamId(channel)] : []) });
      }
      return results;
    },
    async baselineItems(account) {
      const live = await kick.liveChannels([account.id]);
      return live[account.id] ? [{ id: kick.streamId(live[account.id]), live: true }] : [];
    },
  },

  bluesky: {
    interval: 5 * 60_000, perTick: 150, concurrency: 8,
    async resolve(text) {
      const actor = await bluesky.resolveActor(text);
      return { id: actor.id, name: actor.name, avatar: actor.avatar, url: actor.url };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: (await bluesky.fetchPosts(account.id, 15)).map(bluesky.toItem).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await bluesky.fetchPosts(account.id, 15)).map((post) => ({ id: post.id })); },
  },

  modrinth: {
    interval: 10 * 60_000, perTick: 100, concurrency: 4,
    async resolve(text, { lang } = {}) {
      const kind = modrinth.parseNew(text);
      if (kind) return modrinth.newAccount(kind, lang);
      const project = await modrinth.resolveProject(text);
      return { id: project.id, name: project.name, avatar: project.avatar, url: project.url, project };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try {
          const newKind = modrinth.parseNew(account.id);
          if (newKind) { results.set(account.id, { items: (await modrinth.fetchNewProjects(newKind)).filter((item) => fresh(item, now)) }); return; }
          const project = await modrinth.resolveProject(account.id);
          results.set(account.id, { items: (await modrinth.fetchVersions(account.id, 6)).map((version) => modrinth.toItem(project, version)).filter((item) => fresh(item, now)) });
        } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { const newKind = modrinth.parseNew(account.id); return newKind ? (await modrinth.fetchNewProjects(newKind)).map((item) => ({ id: item.id })) : (await modrinth.fetchVersions(account.id, 10)).map((version) => ({ id: version.id })); },
  },

  // ---- Feeds read as RSS / Atom ------------------------------------------------------------------------------------------------------------
  rss: {
    interval: 10 * 60_000, perTick: 150, concurrency: 8,
    resolve: (text) => rss.resolveRss(text),
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: (await rss.readRss(account.id, 15)).entries.map((entry) => rss.toItem('rss', 'post', entry, account)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await rss.readRss(account.id, 20)).entries.map((entry) => ({ id: entry.id })); },
  },

  reddit: {
    interval: 10 * 60_000, perTick: 60, concurrency: 2,
    async resolve(text) {
      const name = rss.parseSubreddit(text);
      if (!name) throw new IntegrationError('badInput');
      const feed = await rss.readReddit(name);
      if (!feed.entries.length && !feed.title) throw new IntegrationError('notFound');
      return { id: name.toLowerCase(), name: `r/${name}`, avatar: feed.image || null, url: `https://www.reddit.com/r/${name}` };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: (await rss.readReddit(account.id)).entries.map((entry) => rss.toItem('reddit', 'post', entry, account)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await rss.readReddit(account.id)).entries.map((entry) => ({ id: entry.id })); },
  },

  pinterest: {
    interval: 15 * 60_000, perTick: 60, concurrency: 2,
    async resolve(text) {
      const id = rss.parsePinterest(text);
      if (!id) throw new IntegrationError('badInput');
      const feed = await rss.readPinterest(id);
      if (!feed.entries.length && !feed.title) throw new IntegrationError('notFound');
      return { id, name: feed.title || id, avatar: feed.image || null, url: `https://www.pinterest.com/${id}/` };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: (await rss.readPinterest(account.id)).entries.map((entry) => rss.toItem('pinterest', 'pin', entry, account)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await rss.readPinterest(account.id)).entries.map((entry) => ({ id: entry.id })); },
  },

  // ---- Developers --------------------------------------------------------------------------------------------------------------------------
  github: {
    interval: 15 * 60_000, perTick: 100, concurrency: 4,
    async resolve(text) { const repo = await github.resolveRepo(text); return { id: repo.id, name: repo.name, avatar: repo.avatar, url: repo.url }; },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: (await github.fetchReleases(account.id)).map((release) => github.toItem(account, release)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await github.fetchReleases(account.id, 10)).map((release) => ({ id: release.id })); },
  },

  npm: {
    interval: 15 * 60_000, perTick: 200, concurrency: 6,
    async resolve(text) {
      const name = packages.parseNpm(text);
      if (!name) throw new IntegrationError('badInput');
      const latest = await packages.npmLatest(name);
      return { id: name, name: latest.name, avatar: null, url: latest.url };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: [packages.toItem('npm', account, await packages.npmLatest(account.id), now)] }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { const latest = await packages.npmLatest(account.id); return [{ id: `${latest.name}@${latest.version}` }]; },
  },

  pypi: {
    interval: 15 * 60_000, perTick: 200, concurrency: 6,
    async resolve(text) {
      const name = packages.parsePypi(text);
      if (!name) throw new IntegrationError('badInput');
      const latest = await packages.pypiLatest(name);
      return { id: name, name: latest.name, avatar: null, url: latest.url };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: [packages.toItem('pypi', account, await packages.pypiLatest(account.id), now)].filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { const latest = await packages.pypiLatest(account.id); return [{ id: `${latest.name}@${latest.version}` }]; },
  },

  // ---- Games, anime, knowledge -------------------------------------------------------------------------------------------------------------
  steam: {
    interval: 10 * 60_000, perTick: 100, concurrency: 4,
    resolve: (text, { lang } = {}) => (steam.parseStore(text) ? steam.storeAccount(steam.parseStore(text), lang) : steam.resolveApp(text)),
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        const list = steam.parseStore(account.id);
        if (list) { try { results.set(account.id, { items: await steam.fetchStoreList(list, now) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); } return; }
        try { results.set(account.id, { items: (await steam.fetchNews(account.id)).map((entry) => steam.toItem(account, entry)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { const list = steam.parseStore(account.id); return list ? (await steam.fetchStoreList(list)).map((item) => ({ id: item.id })) : (await steam.fetchNews(account.id, 10)).map((entry) => ({ id: entry.id })); },
  },

  anilist: {
    interval: 15 * 60_000, perTick: 5000, concurrency: 1,
    resolve: (text) => anilist.resolveAnime(text),
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const episodes = await anilist.recentEpisodes(accounts.map((account) => account.id), now);
      return new Map(accounts.map((account) => [account.id, { items: (episodes[account.id] ?? []).map((episode) => anilist.toItem(account, episode)) }]));
    },
    async baselineItems(account) { return ((await anilist.recentEpisodes([account.id]))[account.id] ?? []).map((episode) => ({ id: episode.id })); },
  },

  deezer: {
    interval: 30 * 60_000, perTick: 120, concurrency: 4,
    resolve: async (text, { lang } = {}) => { const artist = await music.deezerResolve(text, lang); return { id: artist.id, name: artist.name, avatar: artist.avatar, url: artist.url }; },
    poll: listPoll((account, now) => music.deezerReleases(account, now), 4),
    async baselineItems(account) { return (await music.deezerReleases(account, Date.now())).map((item) => ({ id: item.id })); },
  },

  applemusic: {
    interval: 60 * 60_000, perTick: 15, concurrency: 1, // Apple asks for about 20 calls a minute
    resolve: (text, { lang } = {}) => music.appleResolve(text, lang),
    poll: listPoll((account, now) => music.appleReleases(account, now), 1),
    async baselineItems(account) { return (await music.appleReleases(account)).map((item) => ({ id: item.id })); },
  },

  spotify: {
    interval: 30 * 60_000, perTick: 100, concurrency: 3,
    resolve: (text, { lang } = {}) => music.spotifyResolve(text, lang),
    poll: listPoll((account) => music.spotifyReleases(account), 3),
    async baselineItems(account) { return (await music.spotifyReleases(account)).map((item) => ({ id: item.id })); },
  },

  mastodon: {
    interval: 10 * 60_000, perTick: 100, concurrency: 4,
    resolve: (text) => social.resolveMastodon(text),
    poll: listPoll(async (account) => (await social.readMastodon(account.id)).entries.map((entry) => social.toItem('mastodon', 'post', entry, account, { keepTitle: false })), 4),
    async baselineItems(account) { return (await social.readMastodon(account.id)).entries.map((entry) => ({ id: entry.id })); },
  },

  tumblr: {
    interval: 15 * 60_000, perTick: 100, concurrency: 4,
    resolve: (text) => social.resolveTumblr(text),
    poll: listPoll(async (account) => (await social.readTumblr(account.id)).entries.map((entry) => social.toItem('tumblr', 'post', entry, account)), 4),
    async baselineItems(account) { return (await social.readTumblr(account.id)).entries.map((entry) => ({ id: entry.id })); },
  },

  letterboxd: {
    interval: 30 * 60_000, perTick: 100, concurrency: 3,
    resolve: (text) => social.resolveLetterboxd(text),
    poll: listPoll(async (account) => (await social.readLetterboxd(account.id)).entries.map((entry) => social.toItem('letterboxd', 'post', entry, account)), 3),
    async baselineItems(account) { return (await social.readLetterboxd(account.id)).entries.map((entry) => ({ id: entry.id })); },
  },

  epic: {
    interval: 30 * 60_000, perTick: 5000, concurrency: 1, perLanguage: true, noAccount: true,
    async resolve() { return { id: 'free', name: 'Epic Games', avatar: null, url: 'https://store.epicgames.com/free-games' }; }, // i18n-ignore: the name of a brand
    /** The games that are free this week, in the language and country of each server. */
    async poll(accounts, _tracked, { now = Date.now(), lang = 'en' } = {}) {
      const games = await epic.freeGames(lang);
      const dateFormat = new Intl.DateTimeFormat({ en: 'en-US', es: 'es-ES', 'pt-BR': 'pt-BR' }[lang] ?? 'en-US', { dateStyle: 'medium', timeZone: 'UTC' });
      const items = games.map((game) => ({
        platform: 'epic', type: 'game', id: game.id, title: game.title, url: game.url, description: game.description, image: game.image, avatar: game.thumb, author: 'Epic Games', // i18n-ignore: the name of a brand
        authorUrl: 'https://store.epicgames.com/free-games', publishedAt: game.startsAt, extra: game.endsAt ? t(lang, 'feeds.epic.until', { date: dateFormat.format(game.endsAt) }) : '',
      }));
      return new Map(accounts.map((account) => [account.id, { items }])); // no age filter: what is free now is news to a feed that has not seen it, and a new feed starts after these
    },
    async baselineItems() { return (await epic.freeGames('en')).map((game) => ({ id: game.id })); },
  },

  cat: animalFeed('cat'),
  dog: animalFeed('dog'),
  fox: animalFeed('fox'),
  bird: animalFeed('bird'),
  duck: animalFeed('duck'),
  capybara: animalFeed('capybara'),
  bunny: animalFeed('bunny'),
  animals: animalFeed('animals'),
  randommusic: randomMusicFeed,
  pictures: picturesFeed,

  wikipedia: {
    interval: 60_000, perTick: 5000, concurrency: 1, perLanguage: true, noAccount: true,
    // The account is the pace: `featured` (once a day) or `every:N` minutes. `text` is what the dashboard or a command sent (`15`, `2h`...).
    async resolve(text) {
      const minutes = schedule.parseMinutes(text);
      if (minutes === null) throw new IntegrationError('badInput');
      return { id: schedule.accountIdFor('wikipedia', minutes), name: 'Wikipedia', avatar: null, url: 'https://www.wikipedia.org' }; // i18n-ignore: the name of a brand
    },
    /** Once a day: the featured article, from 6:00 UTC (it is chosen by then in every Wikipedia). Every N minutes: a random article for each slot. */
    async poll(accounts, _tracked, { now = Date.now(), lang = 'en' } = {}) {
      const results = new Map();
      for (const account of accounts) {
        const minutes = schedule.minutesOf(account.id);
        if (minutes === schedule.DAY_MINUTES) {
          const article = new Date(now).getUTCHours() < 6 ? null : await daily.featuredArticle(lang, now);
          results.set(account.id, { items: article ? [daily.wikipediaItem(article, now)] : [] });
          continue;
        }
        const slot = schedule.slotOf(now, minutes);
        const article = await daily.randomArticle(lang, `${minutes}:${slot}`);
        results.set(account.id, { items: article ? [{ ...daily.wikipediaItem(article, now), publishedAt: schedule.slotStart(slot, minutes) }] : [] });
      }
      return results;
    },
    /** A pace of minutes starts at the next slot: the one running now is the past. */
    async baselineItems(account, now = Date.now()) {
      const minutes = schedule.minutesOf(account.id);
      return minutes === schedule.DAY_MINUTES ? [] : [{ id: `${minutes}:${schedule.slotOf(now, minutes)}` }];
    },
  },

  chess: {
    interval: 60_000, perTick: 5000, concurrency: 1, noAccount: true,
    async resolve(text) {
      const minutes = schedule.parseMinutes(text);
      if (minutes === null) throw new IntegrationError('badInput');
      return { id: schedule.accountIdFor('chess', minutes), name: 'Chess.com', avatar: null, url: 'https://www.chess.com/daily-chess-puzzle' }; // i18n-ignore: the name of a brand
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      for (const account of accounts) {
        const minutes = schedule.minutesOf(account.id);
        if (minutes === schedule.DAY_MINUTES) {
          const puzzle = await daily.chessPuzzle();
          results.set(account.id, { items: puzzle ? [daily.chessItem(puzzle)] : [] });
          continue;
        }
        const slot = schedule.slotOf(now, minutes);
        const puzzle = await daily.randomPuzzle(`${minutes}:${slot}`);
        results.set(account.id, { items: puzzle ? [{ ...daily.chessItem(puzzle), publishedAt: schedule.slotStart(slot, minutes) }] : [] });
      }
      return results;
    },
    async baselineItems(account, now = Date.now()) {
      const minutes = schedule.minutesOf(account.id);
      return minutes === schedule.DAY_MINUTES ? [] : [{ id: `${minutes}:${schedule.slotOf(now, minutes)}` }];
    },
  },

  pokemon: {
    interval: 60_000, perTick: 5000, concurrency: 1, perLanguage: true, noAccount: true,
    async resolve(text) {
      const minutes = schedule.parseMinutes(text);
      if (minutes === null) throw new IntegrationError('badInput');
      return { id: schedule.accountIdFor('pokemon', minutes), name: 'Pokédex', avatar: null, url: 'https://www.pokemon.com/us/pokedex' }; // i18n-ignore: the name of a brand
    },
    /** Once a day: one Pokémon for everybody, from 14:00 UTC (9 in the morning in Colombia). Every N minutes: the next one of the dex for each slot. */
    async poll(accounts, _tracked, { now = Date.now(), lang = 'en' } = {}) {
      const results = new Map();
      for (const account of accounts) {
        const minutes = schedule.minutesOf(account.id);
        if (minutes === schedule.DAY_MINUTES) {
          if (new Date(now).getUTCHours() < 14) { results.set(account.id, { items: [] }); continue; }
          results.set(account.id, { items: [pokemon.toItem(await pokemon.fetchPokemonKept(pokemon.pokemonOfDay(pokemon.dayNumber(now)), lang), now)] });
          continue;
        }
        const slot = schedule.slotOf(now, minutes);
        const entry = await pokemon.fetchPokemonKept(pokemon.pokemonOfDay(slot), lang);
        results.set(account.id, { items: [{ ...pokemon.toItem(entry, now), id: `${minutes}:${slot}`, publishedAt: schedule.slotStart(slot, minutes) }] });
      }
      return results;
    },
    async baselineItems(account, now = Date.now()) {
      const minutes = schedule.minutesOf(account.id);
      return minutes === schedule.DAY_MINUTES ? [] : [{ id: `${minutes}:${schedule.slotOf(now, minutes)}` }];
    },
  },
};

const isProvider = (platform) => Object.hasOwn(PROVIDERS, platform);

module.exports = { noteLate, PROVIDERS, isProvider, MAX_AGE_MS, fresh, notLive, wasLive, saveYoutubeState, restoreYoutubeState, rememberNotLive };

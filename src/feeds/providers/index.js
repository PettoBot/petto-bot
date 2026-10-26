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
const { fetchPublicText } = require('../http');
const { parseFeed } = require('../feedparse');

/** The videos that were seen live or about to be: when they end they are a recording of a stream, and are not posted as a new video. */
const wasLive = new Set();
const WAS_LIVE_LIMIT = 20_000;
const rememberLive = (id) => { if (wasLive.size >= WAS_LIVE_LIMIT) wasLive.delete(wasLive.values().next().value); wasLive.add(id); };

const HOUR = 3_600_000;
const MAX_AGE_MS = 3 * 24 * HOUR; // an old item that shows up again (a feed that is cleaned up, a long downtime) is not news
const fresh = (item, now) => !item.publishedAt || now - Number(item.publishedAt) <= MAX_AGE_MS;

/** The video ids that are known not to be live (and never will be): asking about them again would only spend quota. */
const notLive = new Set();
const NOT_LIVE_LIMIT = 50_000;
const rememberNotLive = (id) => { if (notLive.size >= NOT_LIVE_LIMIT) notLive.delete(notLive.values().next().value); notLive.add(id); };

const PROVIDERS = {
  youtube: {
    interval: 5 * 60_000, perTick: 300, concurrency: 12,
    async resolve(text) {
      const channel = await youtube.resolveChannel(text);
      return { id: channel.id, name: channel.name, avatar: channel.avatar, url: channel.url };
    },
    async poll(accounts, tracked = new Map(), { now = Date.now(), withLive = true } = {}) {
      const results = new Map();
      const entries = new Map(); // accountId -> entries
      await forEachWithConcurrency(accounts, async (account) => {
        try { entries.set(account.id, (await youtube.fetchChannel(account.id)).entries); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);

      // One call (a unit for up to 50 videos) says which new videos are live or about to be, and whether the streams being followed are still on.
      let states = {};
      if (withLive) {
        const ids = new Set();
        for (const list of entries.values()) for (const entry of list) if (fresh({ publishedAt: entry.published }, now) && !notLive.has(entry.videoId)) ids.add(entry.videoId);
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
          const state = states?.[entry.videoId]?.state;
          if (state === 'live') { rememberLive(entry.videoId); stillLive.add(entry.videoId); items.push(youtube.toItem(entry, 'live', account)); continue; }
          if (state === 'upcoming') { rememberLive(entry.videoId); continue; } // announced, not started: it is posted when it starts
          if (state === 'none' && wasLive.has(entry.videoId)) continue; // a stream that already ended: its recording is not a new video
          if (state === 'none') rememberNotLive(entry.videoId);
          if (fresh({ publishedAt: entry.published }, now)) items.push(youtube.toItem(entry, entry.short ? 'short' : 'video', account));
        }
        for (const id of tracked.get(account.id) ?? []) if (states?.[id]?.state === 'live') stillLive.add(id);
        results.set(account.id, { items, ...(states ? { stillLive } : {}) });
      }
      return results;
    },
    async baselineItems(account) {
      const { entries } = await youtube.fetchChannel(account.id);
      const states = await youtube.liveStates(entries.map((entry) => entry.videoId)).catch(() => ({}));
      return entries.map((entry) => ({ id: entry.videoId, live: states[entry.videoId]?.state === 'live' }));
    },
  },

  twitch: {
    interval: 2 * 60_000, perTick: 2000, concurrency: 1,
    async resolve(text) {
      const user = await twitch.resolveUser(text);
      return { id: user.id, name: user.name, avatar: user.avatar, url: user.url };
    },
    async poll(accounts) {
      const live = await twitch.liveStreams(accounts.map((account) => account.id)); // 100 accounts in each call
      const results = new Map();
      for (const account of accounts) {
        const stream = live[account.id];
        results.set(account.id, { items: stream ? [twitch.toItem(stream, account)] : [], stillLive: new Set(stream ? [stream.id] : []) });
      }
      return results;
    },
    async baselineItems(account) {
      const live = await twitch.liveStreams([account.id]);
      return live[account.id] ? [{ id: live[account.id].id, live: true }] : [];
    },
  },

  kick: {
    interval: 2 * 60_000, perTick: 2000, concurrency: 1,
    async resolve(text) {
      const channel = await kick.resolveChannel(text);
      return { id: channel.id, name: channel.name, avatar: channel.avatar, url: channel.url };
    },
    async poll(accounts) {
      const live = await kick.liveChannels(accounts.map((account) => account.id)); // 50 accounts in each call
      const results = new Map();
      for (const account of accounts) {
        const channel = live[account.id];
        results.set(account.id, { items: channel ? [kick.toItem(channel, account)] : [], stillLive: new Set(channel ? [kick.streamId(channel)] : []) });
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
    async resolve(text) {
      const project = await modrinth.resolveProject(text);
      return { id: project.id, name: project.name, avatar: project.avatar, url: project.url, project };
    },
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try {
          const project = await modrinth.resolveProject(account.id);
          results.set(account.id, { items: (await modrinth.fetchVersions(account.id, 6)).map((version) => modrinth.toItem(project, version)).filter((item) => fresh(item, now)) });
        } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await modrinth.fetchVersions(account.id, 10)).map((version) => ({ id: version.id })); },
  },

  // ---- Feeds read as RSS / Atom ------------------------------------------------------------------------------------------------------------
  rss: {
    interval: 10 * 60_000, perTick: 150, concurrency: 8,
    resolve: (text) => rss.resolveRss(text),
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: parseFeed((await fetchPublicText(account.id)).text, { max: 15 }).entries.map((entry) => rss.toItem('rss', 'post', entry, account)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return parseFeed((await fetchPublicText(account.id)).text, { max: 20 }).entries.map((entry) => ({ id: entry.id })); },
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
    resolve: (text) => steam.resolveApp(text),
    async poll(accounts, _tracked, { now = Date.now() } = {}) {
      const results = new Map();
      await forEachWithConcurrency(accounts, async (account) => {
        try { results.set(account.id, { items: (await steam.fetchNews(account.id)).map((entry) => steam.toItem(account, entry)).filter((item) => fresh(item, now)) }); } catch (error) { results.set(account.id, { items: [], error: error.kind ?? 'unavailable' }); }
      }, this.concurrency);
      return results;
    },
    async baselineItems(account) { return (await steam.fetchNews(account.id, 10)).map((entry) => ({ id: entry.id })); },
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

  wikipedia: {
    interval: HOUR, perTick: 5000, concurrency: 1, perLanguage: true, noAccount: true,
    async resolve() { return { id: 'featured', name: 'Wikipedia', avatar: null, url: 'https://www.wikipedia.org' }; }, // i18n-ignore: the name of a brand
    /** The featured article of the day, from 6:00 UTC (the article of the day is chosen by then in every Wikipedia). */
    async poll(accounts, _tracked, { now = Date.now(), lang = 'en' } = {}) {
      if (new Date(now).getUTCHours() < 6) return new Map(accounts.map((account) => [account.id, { items: [] }]));
      const article = await daily.featuredArticle(lang, now);
      return new Map(accounts.map((account) => [account.id, { items: article ? [daily.wikipediaItem(article, now)] : [] }]));
    },
    async baselineItems() { return []; },
  },

  chess: {
    interval: HOUR, perTick: 5000, concurrency: 1, noAccount: true,
    async resolve() { return { id: 'puzzle', name: 'Chess.com', avatar: null, url: 'https://www.chess.com/daily-chess-puzzle' }; }, // i18n-ignore: the name of a brand
    async poll(accounts) {
      const puzzle = await daily.chessPuzzle();
      return new Map(accounts.map((account) => [account.id, { items: puzzle ? [daily.chessItem(puzzle)] : [] }]));
    },
    async baselineItems() { return []; },
  },

  pokemon: {
    interval: HOUR, perTick: 5000, concurrency: 1, perLanguage: true, noAccount: true,
    async resolve() { return { id: 'daily', name: 'Pokédex', avatar: null, url: 'https://www.pokemon.com/us/pokedex' }; }, // i18n-ignore: the name of a brand
    /** One Pokémon a day for everybody, from 14:00 UTC (9 in the morning in Colombia). The text is in the language of each server by the card. */
    async poll(accounts, _tracked, { now = Date.now(), lang = 'en' } = {}) {
      const results = new Map();
      if (new Date(now).getUTCHours() < 14) return new Map(accounts.map((account) => [account.id, { items: [] }]));
      const item = pokemon.toItem(await pokemon.fetchPokemon(pokemon.pokemonOfDay(pokemon.dayNumber(now)), lang), now);
      for (const account of accounts) results.set(account.id, { items: [item] });
      return results;
    },
    async baselineItems() { return []; },
  },
};

const isProvider = (platform) => Object.hasOwn(PROVIDERS, platform);

module.exports = { PROVIDERS, isProvider, MAX_AGE_MS, fresh, notLive, wasLive };

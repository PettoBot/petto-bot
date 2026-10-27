// What a person can do with the feeds of a server: follow an account, change a feed, stop following, and see it work. The commands and the
// dashboard routes both go through here, so the limits and the checks are the same.
const { PermissionFlagsBits } = require('discord.js');
const feedsDb = require('../db/feeds');
const { guildLimit } = require('../db/premium');
const { PROVIDERS, isProvider } = require('./providers');
const { PLATFORMS } = require('./platforms');
const { buildFeedPayload } = require('./card');
const { MAX_TOP } = require('./text');
const { IntegrationError } = require('../utils/integrations');
const logger = require('../utils/logger');

const SNOWFLAKE = /^\d{15,25}$/;
const MAX_KEYWORDS = 10;

/** The permissions Petto needs in a channel to post a feed there. */
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

/** Why Petto cannot post in a channel, or null when it can. */
function channelProblem(guild, channel) {
  if (!channel || !channel.isTextBased?.() || channel.isDMBased?.()) return 'notText';
  const me = guild.members?.me;
  if (!me) return null;
  const permissions = channel.permissionsFor(me);
  if (!permissions || !permissions.has(NEEDED)) return 'permission';
  return null;
}

const ids = (list, max = 10) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((id) => SNOWFLAKE.test(id)))].slice(0, max);
const words = (list) => [...new Set((Array.isArray(list) ? list : []).map((word) => String(word).trim().toLowerCase()).filter((word) => word && word.length <= 40))].slice(0, MAX_KEYWORDS);

/** What a feed keeps of its options, and nothing else: `image`, `button` and a `color` the dashboard may set. */
function cleanOptions(options = {}) {
  const out = {};
  if (typeof options.image === 'boolean') out.image = options.image;
  if (typeof options.button === 'boolean') out.button = options.button;
  if (Number.isInteger(options.color) && options.color >= 0 && options.color <= 0xffffff) out.color = options.color;
  return out;
}

function cleanTypes(platform, types) {
  const allowed = PLATFORMS[platform].types;
  const chosen = (Array.isArray(types) ? types : []).filter((type) => allowed.includes(type));
  return chosen.length ? [...new Set(chosen)] : PLATFORMS[platform].defaultTypes;
}

/**
 * Follows an account. `input`: { platform, account (what the person wrote), channelId, types?, message?, pingRoles?, pingEveryone?, options?, filters?, createdBy }.
 * Answers { ok: true, feed } or { ok: false, error, ... }. What the account has already posted is marked as seen first, so nothing old is posted.
 */
async function createFeed(guild, input) {
  const platform = String(input.platform ?? '').toLowerCase();
  if (!isProvider(platform)) return { ok: false, error: 'unknownPlatform', platform: platform.slice(0, 30) };
  const channel = guild.channels.cache.get(String(input.channelId ?? ''));
  const problem = channelProblem(guild, channel);
  if (problem) return { ok: false, error: problem };

  const { limit, premium, premiumLimit } = await guildLimit(guild.id, 'feeds');
  // The limit is for each platform: 3 accounts of YouTube, 3 of Twitch... (Premium: 10 of each).
  if ((await feedsDb.countForGuild(guild.id, platform)) >= limit) return { ok: false, error: premium ? 'limit' : 'limitFree', count: limit, premium: premiumLimit, platform: PLATFORMS[platform].name };

  let account;
  try {
    account = await PROVIDERS[platform].resolve(String(input.account ?? '').trim());
  } catch (error) {
    if (error instanceof IntegrationError) return { ok: false, error: error.kind === 'badInput' && PROVIDERS[platform].noAccount ? 'badPace' : error.kind === 'notFound' || error.kind === 'badInput' || error.kind === 'notConfigured' ? error.kind : 'unavailable' };
    throw error;
  }

  let feed;
  try {
    feed = await feedsDb.create({
      guild_id: guild.id, platform, account_id: account.id, account_name: String(account.name).slice(0, 100), account_avatar: account.avatar ?? null, account_url: account.url ?? null,
      channel_id: channel.id, ready: false, types: cleanTypes(platform, input.types), message: String(input.message ?? '').slice(0, MAX_TOP), ping_roles: ids(input.pingRoles), ping_everyone: Boolean(input.pingEveryone),
      options: cleanOptions(input.options), filters: { include: words(input.filters?.include), exclude: words(input.filters?.exclude) }, created_by: input.createdBy ?? null,
    });
  } catch (error) {
    if (error?.code === '23505') return { ok: false, error: 'already', account: account.name };
    throw error;
  }

  // The past is not news: what the account already has is marked as seen. A stream that is on now is marked too, but without a message.
  try {
    const items = await PROVIDERS[platform].baselineItems(account);
    await feedsDb.markSeen(items.map((item) => [feed.id, String(item.id)]));
    feed = await feedsDb.update(guild.id, feed.id, { ready: true });
  } catch (error) {
    logger.warn(`Feed ${feed.id}: could not read what ${platform}/${account.id} already has: ${error.message}`);
  }
  return { ok: true, feed };
}

/** Changes what a person may change of a feed. `patch`: { channelId, types, message, pingRoles, pingEveryone, options, filters, enabled, every }. */
async function updateFeed(guild, id, patch) {
  const current = await feedsDb.get(guild.id, id);
  if (!current) return { ok: false, error: 'notFound' };
  const row = {};
  if (patch.channelId !== undefined) {
    const channel = guild.channels.cache.get(String(patch.channelId));
    const problem = channelProblem(guild, channel);
    if (problem) return { ok: false, error: problem };
    row.channel_id = channel.id;
  }
  if (patch.types !== undefined) row.types = cleanTypes(current.platform, patch.types);
  if (patch.message !== undefined) row.message = String(patch.message).slice(0, MAX_TOP);
  if (patch.pingRoles !== undefined) row.ping_roles = ids(patch.pingRoles);
  if (patch.pingEveryone !== undefined) row.ping_everyone = Boolean(patch.pingEveryone);
  if (patch.options !== undefined) row.options = { ...current.options, ...cleanOptions(patch.options) };
  if (patch.filters !== undefined) row.filters = { include: words(patch.filters.include), exclude: words(patch.filters.exclude) };
  if (patch.enabled !== undefined) { row.enabled = Boolean(patch.enabled); if (row.enabled) { row.failures = 0; row.last_error = null; } }
  // The pace of an auto feed (the Pokémon, Wikipedia, Chess.com) is part of its account: a new pace is a new account that starts at its next slot.
  if (patch.every !== undefined && PROVIDERS[current.platform]?.noAccount) {
    let account;
    try {
      account = await PROVIDERS[current.platform].resolve(String(patch.every).trim());
    } catch (error) {
      if (error instanceof IntegrationError) return { ok: false, error: error.kind === 'badInput' ? 'badPace' : 'unavailable' };
      throw error;
    }
    if (account.id !== current.account_id) {
      try {
        await feedsDb.markSeen((await PROVIDERS[current.platform].baselineItems(account)).map((item) => [current.id, String(item.id)]));
      } catch (error) {
        logger.warn(`Feed ${current.id}: could not mark what the new pace already has: ${error.message}`);
      }
      Object.assign(row, { account_id: account.id, account_name: String(account.name).slice(0, 100), account_url: account.url ?? null });
    }
  }
  if (!Object.keys(row).length) return { ok: true, feed: current };
  try {
    return { ok: true, feed: await feedsDb.update(guild.id, id, row) };
  } catch (error) {
    if (error?.code === '23505') return { ok: false, error: 'already', account: current.account_name }; // the same pace in the same channel is already followed
    throw error;
  }
}

/** A notice to show how a feed looks: the newest thing of the account, or an example when it has nothing. */
async function sampleItem(feed, lang) {
  const provider = PROVIDERS[feed.platform];
  const account = { id: feed.account_id, name: feed.account_name, avatar: feed.account_avatar, url: feed.account_url };
  try {
    const result = (await provider.poll([account], new Map(), { lang, withLive: false, now: Date.now() })).get(account.id);
    const wanted = feed.types ?? [];
    const item = (result?.items ?? []).find((candidate) => wanted.includes(candidate.type)) ?? result?.items?.[0];
    if (item) return item;
  } catch { /* the example below */ }
  const type = (feed.types ?? [])[0] ?? PLATFORMS[feed.platform].defaultTypes[0];
  return { platform: feed.platform, type, title: feed.account_name, url: feed.account_url ?? PLATFORMS[feed.platform].site, avatar: feed.account_avatar, author: feed.account_name, publishedAt: Date.now() };
}

/** Posts the notice of a feed once, marked as a test, in its channel. */
async function sendTest(guild, feed, lang) {
  const channel = guild.channels.cache.get(feed.channel_id);
  const problem = channelProblem(guild, channel);
  if (problem) return { ok: false, error: problem };
  const item = await sampleItem(feed, lang);
  const message = await channel.send(await buildFeedPayload(feed, item, { lang, test: true })).catch((error) => ({ error }));
  if (message?.error) return { ok: false, error: 'permission', detail: message.error.message };
  return { ok: true, channel, message };
}

module.exports = { createFeed, updateFeed, sendTest, sampleItem, channelProblem, cleanOptions, cleanTypes, NEEDED };

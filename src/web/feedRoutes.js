// Feeds from the dashboard. The dashboard reads the feeds straight from the database; these routes need the bot (the account to look up, the
// checks of the channel, the limits, the first look, a test notice and the card as it will be posted):
//   POST /api/dashboard/guild/:guildId/feeds/resolve { platform, account }  -> { ok, account: { id, name, avatar, url } }
//   POST /api/dashboard/guild/:guildId/feeds/create  { platform, account, channel_id, types, message, ping_roles, ping_everyone, options, filters }
//   POST /api/dashboard/guild/:guildId/feeds/update  { id, channel_id?, types?, message?, ping_roles?, ping_everyone?, options?, filters?, enabled? }
//   POST /api/dashboard/guild/:guildId/feeds/delete  { id }
//   POST /api/dashboard/guild/:guildId/feeds/test    { id }                 posts a test notice in the channel of the feed
//   POST /api/dashboard/guild/:guildId/feeds/preview { platform, type, message, ping_roles, ping_everyone, options, id?, account? }
//        -> { ok, lang, messages: [the message as Discord receives it] } with an example notice (or, with `id`, the newest real one)
// The same access as the other dashboard routes: the dashboard key and a `user_id` who can manage the server.
const feedsDb = require('../db/feeds');
const service = require('../feeds/service');
const { PROVIDERS, isProvider } = require('../feeds/providers');
const { PLATFORMS } = require('../feeds/platforms');
const { buildFeedMessage } = require('../feeds/card');
const { sampleNotice } = require('../feeds/samples');
const { IntegrationError } = require('../utils/integrations');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

const RESOLVE_PER_MINUTE = 12; // each search of a YouTube channel costs quota: a server cannot spend it all
const KEEP_MS = 10 * 60_000;
const resolved = new Map(); // `${platform}:${text}` -> { until, value }
const perGuild = new Map(); // guildId -> { minute, count }

const idOf = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

function takeResolveTurn(guildId, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const entry = perGuild.get(guildId);
  if (!entry || entry.minute !== minute) { perGuild.set(guildId, { minute, count: 1 }); return true; }
  entry.count += 1;
  return entry.count <= RESOLVE_PER_MINUTE;
}

/** The text of an error of `createFeed`/`sendTest`, without the emoji the chat messages carry. */
function errorText(lang, result, platform) {
  return t(lang, `feeds.add.error.${result.error}`, { emoji: '', platform: result.platform ?? PLATFORMS[platform]?.name ?? '', count: result.count, premium: result.premium, account: result.account, prefix: '!' }).trim();
}

function registerFeedRoutes(app, { authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];
  const route = (name, handler) => app.post(`/api/dashboard/guild/:guildId/feeds/${name}`, ...middleware, async (req, res) => {
    const access = await authorize(req, res, { page: 'feeds', edit: !['resolve', 'preview'].includes(name) });
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    try {
      await handler(req, res, access, lang);
    } catch (err) {
      logger.error(`Dashboard feeds ${name} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, message: t(lang, 'web.api.forms.failed') });
    }
  });

  route('resolve', async (req, res, { guild }, lang) => {
    const platform = String(req.body?.platform ?? '').toLowerCase();
    const text = String(req.body?.account ?? '').trim().slice(0, 200);
    if (!isProvider(platform) || (!text && !PROVIDERS[platform]?.noAccount)) { res.status(400).json({ ok: false, message: t(lang, 'feeds.add.error.badInput', { emoji: '', platform: PLATFORMS[platform]?.name ?? '' }).trim() }); return; }
    const key = `${platform}:${text.toLowerCase()}`;
    const kept = resolved.get(key);
    if (kept && kept.until > Date.now()) { res.json({ ok: true, account: kept.value }); return; }
    if (!takeResolveTurn(guild.id)) { res.status(429).json({ ok: false, message: t(lang, 'feeds.add.error.unavailable', { emoji: '', platform: PLATFORMS[platform].name }).trim() }); return; }
    try {
      const { id, name, avatar, url } = await PROVIDERS[platform].resolve(text);
      const value = { id, name, avatar: avatar ?? null, url: url ?? null };
      if (resolved.size > 2000) resolved.clear();
      resolved.set(key, { until: Date.now() + KEEP_MS, value });
      res.json({ ok: true, account: value });
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      const kind = ['notFound', 'badInput', 'notConfigured'].includes(error.kind) ? error.kind : 'unavailable';
      res.status(kind === 'unavailable' ? 502 : 404).json({ ok: false, error: kind, message: t(lang, `feeds.add.error.${kind}`, { emoji: '', platform: PLATFORMS[platform].name }).trim() });
    }
  });

  route('create', async (req, res, { guild, userId }, lang) => {
    const body = req.body ?? {};
    const result = await service.createFeed(guild, {
      platform: body.platform, account: body.account, channelId: body.channel_id, types: body.types, message: body.message, pingRoles: body.ping_roles,
      pingEveryone: body.ping_everyone, options: body.options, filters: body.filters, createdBy: userId,
    });
    if (!result.ok) { res.status(400).json({ ok: false, error: result.error, message: errorText(lang, result, String(body.platform ?? '')) }); return; }
    res.json({ ok: true, feed: result.feed, message: t(lang, 'feeds.add.ok', { emoji: '', account: result.feed.account_name, platform: PLATFORMS[result.feed.platform].name, channel: `#${guild.channels.cache.get(result.feed.channel_id)?.name ?? ''}`, id: result.feed.id, prefix: '!' }).trim() });
  });

  route('update', async (req, res, { guild }, lang) => {
    const body = req.body ?? {};
    const id = idOf(body.id);
    if (!id) { res.status(400).json({ ok: false, message: t(lang, 'feeds.notFound', { emoji: '', id: '?', prefix: '!' }).trim() }); return; }
    const patch = {};
    if (body.channel_id !== undefined) patch.channelId = body.channel_id;
    for (const key of ['types', 'message', 'options', 'filters', 'enabled']) if (body[key] !== undefined) patch[key] = body[key];
    if (body.ping_roles !== undefined) patch.pingRoles = body.ping_roles;
    if (body.ping_everyone !== undefined) patch.pingEveryone = body.ping_everyone;
    const result = await service.updateFeed(guild, id, patch);
    if (!result.ok) { res.status(result.error === 'notFound' ? 404 : 400).json({ ok: false, error: result.error, message: result.error === 'notFound' ? t(lang, 'feeds.notFound', { emoji: '', id, prefix: '!' }).trim() : errorText(lang, result, '') }); return; }
    res.json({ ok: true, feed: result.feed });
  });

  route('delete', async (req, res, { guild }, lang) => {
    const id = idOf(req.body?.id);
    const removed = id ? await feedsDb.remove(guild.id, id) : false;
    if (!removed) { res.status(404).json({ ok: false, message: t(lang, 'feeds.notFound', { emoji: '', id: id ?? '?', prefix: '!' }).trim() }); return; }
    res.json({ ok: true });
  });

  route('test', async (req, res, { guild }, lang) => {
    const id = idOf(req.body?.id);
    const feed = id ? await feedsDb.get(guild.id, id) : null;
    if (!feed) { res.status(404).json({ ok: false, message: t(lang, 'feeds.notFound', { emoji: '', id: id ?? '?', prefix: '!' }).trim() }); return; }
    const result = await service.sendTest(guild, feed, lang);
    if (!result.ok) { res.status(400).json({ ok: false, error: result.error, message: errorText(lang, result, feed.platform) }); return; }
    res.json({ ok: true, message: t(lang, 'feeds.test.ok', { emoji: '', channel: `#${result.channel.name ?? ''}` }).trim() });
  });

  route('preview', async (req, res, { guild }, lang) => {
    const body = req.body ?? {};
    const platform = String(body.platform ?? '').toLowerCase();
    if (!PLATFORMS[platform]) { res.status(400).json({ ok: false, message: t(lang, 'feeds.add.error.unknownPlatform', { emoji: '', platform: platform.slice(0, 30) }).trim() }); return; }
    const feed = {
      message: String(body.message ?? '').slice(0, 1500), ping_roles: Array.isArray(body.ping_roles) ? body.ping_roles : [], ping_everyone: Boolean(body.ping_everyone), options: service.cleanOptions(body.options),
    };
    let item = null;
    const id = idOf(body.id);
    if (id) {
      const saved = await feedsDb.get(guild.id, id);
      if (saved) item = await service.sampleItem({ ...saved, types: body.type ? [String(body.type)] : saved.types }, lang);
    }
    item ??= sampleNotice(platform, String(body.type ?? PLATFORMS[platform].defaultTypes[0]), lang, body.account);
    res.json({ ok: true, lang, messages: [buildFeedMessage(feed, item, { lang }).components.map((component) => component.toJSON())] });
  });
}

module.exports = { registerFeedRoutes };

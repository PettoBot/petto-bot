// Forum support on the dashboard. The setups themselves are saved by the website straight in the database; these routes need the bot:
//   POST /api/dashboard/guild/:guildId/forums/ping      {}                                   -> { ok, version, max_setups }  (the site asks first: an older bot has no such route)
//   POST /api/dashboard/guild/:guildId/forums/channels  {}                                   -> { ok, forums: [{ id, name, tags, can_post, missing }] }
//   POST /api/dashboard/guild/:guildId/forums/posts     { status, setup_id, page, limit }    -> { ok, posts, counts }
//   POST /api/dashboard/guild/:guildId/forums/panel     { setup_id, channel_id, only_if_posted } -> { ok, message, url } (posts the panel, or edits it when it is already there; `only_if_posted` only redraws one that stands)
//   POST /api/dashboard/guild/:guildId/forums/action    { thread_id, action, reason }        -> { ok, message }  (lock, unlock, close, reopen, solved, unsolved)
// The same access as the other pages: the dashboard key and a `user_id` who manages the server, or whose role opens the Forums page of
// "Dashboard access" (view for the reads, edit for the panel and the actions; see dashboardRoleAccess.js). The actions are the bot's own
// (utils/forumActions.js), so a post closed here is the same as one closed with `!forum close`.
const { ChannelType } = require('discord.js');
const forumsDb = require('../db/forums');
const config = require('../utils/forumConfig');
const actions = require('../utils/forumActions');
const cards = require('../utils/forumCards');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

const VERSION = 1;
const SNOWFLAKE = /^\d{15,25}$/;
const ACTIONS = ['lock', 'unlock', 'close', 'reopen', 'solved', 'unsolved'];
const KIND = { lock: 'locked', unlock: 'unlocked', close: 'closed', reopen: 'reopened', solved: 'solved', unsolved: 'unsolved' };

function registerForumRoutes(app, { authorize, limiter = null }) {
  const middleware = limiter ? [limiter] : [];
  const route = (name, options, handler) => app.post(`/api/dashboard/guild/:guildId/forums/${name}`, ...middleware, async (req, res) => {
    const access = await authorize(req, res, options);
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    try {
      await handler(req, res, access, lang);
    } catch (err) {
      logger.error(`Dashboard forums ${name} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, message: t(lang, 'web.api.forums.failed') });
    }
  });

  route('ping', { page: 'forums', edit: false }, async (req, res) => {
    res.json({ ok: true, version: VERSION, max_setups: config.MAX_SETUPS });
  });

  route('channels', { page: 'forums', edit: false }, async (req, res, { guild }) => {
    const forums = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildForum).sort((a, b) => a.position - b.position).map((forum) => {
      const missing = config.missingPermissions(forum, guild.members.me);
      return {
        id: forum.id, name: forum.name, can_post: missing.length === 0, missing,
        optional_missing: config.missingPermissions(forum, guild.members.me, config.OPTIONAL_PERMISSIONS),
        tags: (forum.availableTags ?? []).map((tag) => ({ id: tag.id, name: tag.name, moderated: Boolean(tag.moderated), emoji: tag.emoji?.name ?? null })),
      };
    });
    res.set('Cache-Control', 'no-store'); // i18n-ignore: HTTP header
    res.json({ ok: true, forums });
  });

  route('posts', { page: 'forums', edit: false }, async (req, res, { guild }) => {
    const asked = String(req.body?.status ?? 'open');
    const status = ['open', 'solved', 'locked', 'closed', 'all'].includes(asked) ? asked : 'open';
    const setupId = /^\d{1,15}$/.test(String(req.body?.setup_id ?? '')) ? String(req.body.setup_id) : null;
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 25));
    const page = Math.max(0, Math.trunc(Number(req.body?.page) || 0));
    const query = { status: status === 'all' ? null : status, setupId };
    const [rows, total, open] = await Promise.all([forumsDb.listPosts(guild.id, { ...query, limit, offset: page * limit }), forumsDb.countPosts(guild.id, query), forumsDb.countPosts(guild.id, { status: 'open', setupId })]);
    const posts = rows.map((post) => {
      const thread = guild.channels.cache.get(post.thread_id);
      const author = guild.members.cache.get(post.author_id);
      return {
        thread_id: post.thread_id, setup_id: post.setup_id, title: thread?.name ?? post.title, status: post.status, source: post.source,
        author: { id: post.author_id, name: author?.displayName ?? author?.user?.username ?? post.author_id },
        claimed_by: post.claimed_by, opened_at: post.opened_at, last_activity_at: post.last_activity_at, solved_at: post.solved_at,
        url: `https://discord.com/channels/${guild.id}/${post.thread_id}`,
      };
    });
    res.set('Cache-Control', 'no-store'); // i18n-ignore: HTTP header
    res.json({ ok: true, posts, total, open, page, limit });
  });

  route('panel', { page: 'forums', edit: true }, async (req, res, { guild }, lang) => {
    const setup = await forumsDb.getSetupById(req.body?.setup_id);
    if (!setup || setup.guild_id !== guild.id) { res.status(404).json({ ok: false, message: t(lang, 'web.api.forums.noSetup') }); return; }
    // The switch of a setup draws the panel again when there is one (the button follows it); nothing is posted.
    if (req.body?.only_if_posted === true) {
      const refreshed = await actions.refreshPanel(guild, setup, lang);
      res.json({ ok: true, refreshed, message: t(lang, 'web.api.forums.panelUpdated') });
      return;
    }
    const channelId = String(req.body?.channel_id || setup.panel_channel_id || '');
    const channel = SNOWFLAKE.test(channelId) ? guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel) { res.status(400).json({ ok: false, message: t(lang, 'web.api.forums.pickChannel') }); return; }
    const result = await actions.postPanel({ guild, setup, channel, lang });
    if (!result.ok) { res.status(400).json({ ok: false, code: result.error, message: t(lang, `forums.panel.error.${result.error}`, { prefix: '!' }) }); return; }
    res.json({ ok: true, message: t(lang, result.edited ? 'web.api.forums.panelUpdated' : 'web.api.forums.panelPosted'), url: result.message.url ?? null, edited: result.edited });
  });

  route('action', { page: 'forums', edit: true }, async (req, res, access, lang) => {
    const { guild, userId } = access;
    const action = String(req.body?.action ?? '');
    if (!ACTIONS.includes(action)) { res.status(400).json({ ok: false, message: t(lang, 'web.api.forums.badAction') }); return; }
    const threadId = String(req.body?.thread_id ?? '');
    const post = SNOWFLAKE.test(threadId) ? await forumsDb.getPost(threadId) : null;
    if (!post || post.guild_id !== guild.id) { res.status(404).json({ ok: false, message: t(lang, 'web.api.forums.notFound') }); return; }
    const thread = guild.channels.cache.get(threadId) ?? await guild.channels.fetch(threadId).catch(() => null);
    if (!thread?.isThread?.()) { res.status(404).json({ ok: false, message: t(lang, 'web.api.forums.noThread') }); return; }
    const ctx = await actions.loadContext(thread);
    ctx.lang = lang;
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || null;
    const say = (kind) => thread.send(cards.buildDone(kind, { actor: userId, thread: thread.id, reason, lang: ctx.lang })).catch(() => null);
    try {
      if (action === 'lock') { await actions.lockPost(ctx, { actor: userId, reason }); await say('locked'); }
      else if (action === 'unlock') { await actions.unlockPost(ctx, { actor: userId }); await say('unlocked'); }
      else if (action === 'close') await actions.closePost(ctx, { actor: userId, reason, announce: () => say('closed') });
      else if (action === 'reopen') { await actions.reopenPost(ctx, { actor: userId }); await say('reopened'); }
      else if (action === 'solved') { await actions.solvePost(ctx, { actor: userId }); await say('solved'); }
      else { await actions.unsolvePost(ctx, { actor: userId }); await say('unsolved'); }
    } catch (error) {
      if (!error.userFacing) logger.error(`Dashboard forum action ${action} failed in ${threadId}:`, error);
      res.status(error.userFacing ? 409 : 500).json({ ok: false, message: actions.describeError(error, lang) });
      return;
    }
    res.json({ ok: true, message: t(lang, `web.api.forums.done.${action}`), status: (await forumsDb.getPost(threadId))?.status ?? null, kind: KIND[action] });
  });
}

module.exports = { registerForumRoutes, VERSION, ACTIONS };

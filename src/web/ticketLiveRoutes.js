// Live tickets on the dashboard (Tickets → Live tickets): the open tickets of a server as they change, the last messages of one, and what
// the staff does with a ticket without opening Discord.
//   POST /api/dashboard/guild/:guildId/tickets/live/list      {}                    the open tickets: type, opener, claimer, age, last message
//   POST /api/dashboard/guild/:guildId/tickets/live/messages  { ticket }            the last 50 messages of one ticket and its details
//   POST /api/dashboard/guild/:guildId/tickets/live/reply     { ticket, content }   a message as Petto, headed with the staff member's name
//   POST /api/dashboard/guild/:guildId/tickets/live/claim     { ticket }            (and unclaim)
//   POST /api/dashboard/guild/:guildId/tickets/live/add       { ticket, target }    (and remove) a member, by ID or mention
//   POST /api/dashboard/guild/:guildId/tickets/live/close     { ticket, reason }    closed as from Discord, transcript and all
// Access: the dashboard key and a `user_id` who manages the server, or a member whose role has the Tickets section of "Dashboard access"
// (view for the two reads, edit for the rest). Such a member only sees the tickets whose channel they can see in Discord, and every
// action (also for managers) needs what the buttons in Discord need: a support role of the ticket's type or Manage Server, and in
// exclusive claim mode being the claimer. The actions are the bot's own (utils/ticketActions.js), so a ticket closed here is the same
// as one closed in Discord. Replies never ping anyone. Every answer is `{ ok, message?, code? ... }`, the message in the language of the
// request. Reads are kept short: one database read, Discord's cache, and at most one fetch of 50 messages per ticket.
const { PermissionFlagsBits, SnowflakeUtil, OverwriteType } = require('discord.js');
const { rateLimit } = require('express-rate-limit');
const logger = require('../utils/logger');
const { EMOJI } = require('../utils/emojis');
const { t, requestLanguage, guildLanguage } = require('../i18n');

const READS = { max: 150, windowMs: 60_000 };
const WRITES = { max: 30, windowMs: 60_000 };
const REPLIES = { max: 5, windowMs: 10_000 };
const MAX_REPLY = 1800;
const MAX_REASON = 500;
const MESSAGES = 50;
// The messages of a ticket are read again from Discord when a new one arrived, or after this long (an edit or a deletion).
const MESSAGES_FRESH_MS = 15_000;
// Budgets that keep each answer short: whatever is not known in time is left out (and the next read fills it in).
const LOOKUP_BUDGET_MS = 650;
const FETCH_BUDGET_MS = 1_100;
const CLOSE_WAIT_MS = 1_000;
const MAX_LOOKUPS = 8;
const SNOWFLAKE = /^\d{15,25}$/;
// The look (sender identity) of ticket messages: a dashboard reply looks like the rest of Petto's messages in the ticket.
const FEATURE = 'tickets'; // i18n-ignore: the internal name of the sender identity
const WRITE_ACTIONS = new Set(['reply', 'claim', 'unclaim', 'add', 'remove', 'close']);

const later = (ms, value) => new Promise((resolve) => { const timer = setTimeout(() => resolve(value), ms); timer.unref?.(); });
const within = (promise, ms, fallback) => Promise.race([Promise.resolve(promise).catch(() => fallback), later(ms, fallback)]);

/** A name for the first line of a reply: no Markdown, no mentions, no line breaks. */
function plainName(name) {
  return String(name ?? '').replace(/[\\*_~`|>#[\]()<@:]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);
}

/** The member ID in "123…", "<@123…>" or "<@!123…>". */
function targetId(raw) {
  const match = /^<@!?(\d{15,25})>$/.exec(String(raw ?? '').trim()) ?? /^(\d{15,25})$/.exec(String(raw ?? '').trim());
  return match ? match[1] : null;
}

/**
 * @param {any} app
 * @param {{ authorize: Function, limiter?: Function | null, deps?: Record<string, any> }} options
 */
function registerTicketLiveRoutes(app, { authorize, limiter = null, deps = {} }) {
  const db = deps.db ?? require('../db/ticketLive');
  const settingsDb = deps.settingsDb ?? require('../db/ticketSettings');
  const live = deps.live ?? require('../utils/ticketLive');
  const loadActions = () => deps.actions ?? require('../utils/ticketActions');
  const loadSend = () => deps.sendAs ?? require('../utils/senderIdentity').sendAs;
  const touchActivity = deps.touchActivity ?? ((...args) => require('../db/tickets').touchActivity(...args));
  const serverLanguage = deps.guildLanguage ?? guildLanguage;
  const now = deps.now ?? Date.now;

  // ── limits per member of the dashboard and server (the website calls from one address, so its address says nothing)
  const hits = new Map();
  function limited(key, { max, windowMs }) {
    const at = now();
    const list = (hits.get(key) ?? []).filter((time) => at - time < windowMs);
    const over = list.length >= max;
    if (!over) list.push(at);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((time) => at - time < 60_000)) hits.delete(k);
    return over;
  }

  // ── who can see what
  const isManager = (access) => !access.viaRole;
  function canSee(access, channel) {
    if (isManager(access)) return true;
    if (!channel || typeof channel.permissionsFor !== 'function') return false;
    return Boolean(channel.permissionsFor(access.member)?.has(PermissionFlagsBits.ViewChannel));
  }

  // ── people
  function personOf(guild, id) {
    if (!id) return null;
    const member = guild.members?.cache?.get(id);
    const user = member?.user ?? guild.client?.users?.cache?.get(id);
    if (!member && !user) return null;
    const avatar = typeof member?.displayAvatarURL === 'function' ? member.displayAvatarURL({ size: 64 }) : typeof user?.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 64 }) : null;
    return { id, name: member?.displayName ?? user?.globalName ?? user?.username ?? id, username: user?.username ?? null, avatar: avatar ?? null, bot: Boolean(user?.bot) };
  }
  /** The people of a list, from the cache, and the missing ones (a few) from Discord within the budget. */
  async function people(guild, ids) {
    const found = new Map();
    const missing = [];
    for (const id of new Set(ids.filter(Boolean))) {
      const person = personOf(guild, id);
      if (person) found.set(id, person);
      else missing.push(id);
    }
    if (missing.length && guild.client?.users?.fetch) {
      await within(Promise.all(missing.slice(0, MAX_LOOKUPS).map((id) => guild.client.users.fetch(id).then(() => {}).catch(() => {}))), LOOKUP_BUDGET_MS, null);
      for (const id of missing) {
        const person = personOf(guild, id);
        found.set(id, person ?? { id, name: id, username: null, avatar: null, bot: false });
      }
    }
    return found;
  }

  // ── the last message of a ticket channel
  function entryOf(message, before = null) {
    return {
      messageId: String(message.id),
      at: Number(message.createdTimestamp) || SnowflakeUtil.timestampFrom(String(message.id)),
      authorId: String(message.author?.id ?? ''),
      bot: Boolean(message.author?.bot || message.webhookId),
      staffReply: before?.messageId === String(message.id) ? Boolean(before.staffReply) : false,
      staff: null,
    };
  }
  function lastOf(channel) {
    const lastId = channel?.lastMessageId;
    if (!lastId) return null;
    const known = live.lastActivity(channel.id);
    if (known && known.messageId === lastId) return known;
    const cached = channel.messages?.cache?.get?.(lastId);
    if (cached) {
      const entry = entryOf(cached, known);
      live.recordActivity(channel.id, entry);
      return entry;
    }
    return { messageId: String(lastId), at: SnowflakeUtil.timestampFrom(String(lastId)), authorId: '', bot: false, unknown: true };
  }
  /** Whether the opener waits for the staff: the last word is not the staff's (a card of Petto's counts as nobody's while unclaimed). */
  function waiting(entry, ticket, category, guild) {
    if (!entry) return !ticket.claimed_by;
    if (entry.unknown) return null;
    if (entry.staffReply) return false;
    if (entry.bot) return !ticket.claimed_by;
    if (entry.authorId === ticket.opener_id) return true;
    if (ticket.claimed_by && entry.authorId === ticket.claimed_by) return false;
    const member = guild.members?.cache?.get(entry.authorId);
    if (!member) return false;
    const support = category?.support_role_ids ?? [];
    const staff = Boolean(member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) || support.some((id) => member.roles?.cache?.has?.(id));
    return !staff;
  }

  // ── the messages of a ticket, shared by everyone who looks at it
  const messageCache = new Map(); // channel id -> { lastId, at, list }
  const inflight = new Map();
  async function recentMessages(channel) {
    const cached = messageCache.get(channel.id);
    if (cached && cached.lastId === (channel.lastMessageId ?? null) && now() - cached.at < MESSAGES_FRESH_MS) return { list: cached.list, stale: false };
    if (!inflight.has(channel.id)) {
      const request = Promise.resolve(channel.messages.fetch({ limit: MESSAGES }))
        .then((collection) => {
          const messages = [...collection.values()].sort((a, b) => Number(a.createdTimestamp) - Number(b.createdTimestamp));
          const list = messages.map((message) => live.summarizeMessage(message));
          const last = messages.at(-1);
          if (last) live.recordActivity(channel.id, entryOf(last, live.lastActivity(channel.id)));
          messageCache.set(channel.id, { lastId: channel.lastMessageId ?? last?.id ?? null, at: now(), list });
          if (messageCache.size > 500) messageCache.delete(messageCache.keys().next().value);
          return list;
        })
        .finally(() => inflight.delete(channel.id));
      inflight.set(channel.id, request);
    }
    const list = await within(inflight.get(channel.id), FETCH_BUDGET_MS, null);
    if (list) return { list, stale: false };
    return { list: cached?.list ?? [], stale: true };
  }

  function ticketRow({ ticket, category, channel, entry, found, guild }) {
    const lastAuthor = entry && !entry.unknown ? (found.get(entry.authorId) ?? { id: entry.authorId, name: entry.authorId, avatar: null, bot: entry.bot }) : null;
    return {
      number: ticket.ticket_number,
      status: ticket.status,
      priority: ticket.priority ?? 'normal',
      category: { label: category?.label ?? null, emoji: category?.emoji ?? null },
      opener: found.get(ticket.opener_id) ?? { id: ticket.opener_id, name: ticket.opener_id, avatar: null },
      claimedBy: ticket.claimed_by ? (found.get(ticket.claimed_by) ?? { id: ticket.claimed_by, name: ticket.claimed_by, avatar: null }) : null,
      channelId: ticket.channel_id ?? null,
      channelName: channel?.name ?? null,
      channelGone: !channel,
      openedAt: ticket.created_at ? new Date(ticket.created_at).toISOString() : null,
      lastMessageAt: entry ? new Date(entry.at).toISOString() : null,
      lastAuthor: lastAuthor ? { id: lastAuthor.id, name: lastAuthor.name, bot: Boolean(entry.bot), staffReply: Boolean(entry.staffReply) } : null,
      waiting: waiting(entry, ticket, category, guild),
    };
  }

  const reply = (res, lang) => ({
    fail: (status, code, key = code, vars = {}) => res.status(status).json({ ok: false, code, message: t(lang, `web.api.ticketLive.${key}`, vars) }),
  });

  // A wide limit for the reads, per address: every dashboard request comes from the website's one address, so the real limits are
  // the ones per member and server below; this one only stops a flood.
  const readLimiter = rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false });

  // ── the open tickets
  app.post('/api/dashboard/guild/:guildId/tickets/live/list', readLimiter, async (req, res) => {
    const access = await authorize(req, res, { page: 'tickets', edit: false });
    if (!access) return;
    const { guild, userId } = access;
    const lang = requestLanguage(req, guild.id);
    const { fail } = reply(res, lang);
    if (limited(`r:${guild.id}:${userId}`, READS)) { fail(429, 'slow_down', 'slowDown'); return; }
    try {
      const [tickets, categories] = await Promise.all([db.listOpenTickets(guild.id), db.listCategories(guild.id)]);
      live.watch(guild.id, tickets);
      const types = new Map(categories.map((category) => [String(category.id), category]));
      const visible = [];
      const unknown = [];
      for (const ticket of tickets) {
        const channel = ticket.channel_id ? guild.channels?.cache?.get(ticket.channel_id) ?? null : null;
        if (!canSee(access, channel)) continue;
        const entry = lastOf(channel);
        visible.push({ ticket, channel, entry, category: types.get(String(ticket.category_id)) ?? null });
        if (entry?.unknown && unknown.length < MAX_LOOKUPS) unknown.push(visible.at(-1));
      }
      // The last message of a few channels whose last message Discord's cache does not have, at once and within the budget.
      if (unknown.length) {
        await within(Promise.all(unknown.map(async (item) => {
          const collection = await item.channel.messages.fetch({ limit: 1 }).catch(() => null);
          const message = collection?.first?.();
          if (message) {
            const entry = entryOf(message, live.lastActivity(item.channel.id));
            live.recordActivity(item.channel.id, entry);
            item.entry = entry;
          }
        })), LOOKUP_BUDGET_MS, null);
      }
      const ids = visible.flatMap(({ ticket, entry }) => [ticket.opener_id, ticket.claimed_by, entry && !entry.unknown ? entry.authorId : null]);
      const found = await people(guild, ids);
      res.json({
        ok: true,
        tickets: visible.map((item) => ticketRow({ ...item, found, guild })),
        total: tickets.length,
        limit: db.MAX_OPEN ?? 100,
        viewer: { manager: isManager(access) },
        now: new Date(now()).toISOString(),
      });
    } catch (err) {
      logger.error(`Dashboard live tickets failed for guild ${req.params.guildId}:`, err);
      fail(500, 'failed');
    }
  });

  async function loadTicket(guild, body) {
    const number = Number(body?.ticket);
    if (!Number.isInteger(number) || number < 1 || number > 10_000_000) return null;
    const ticket = await db.getTicket(guild.id, number);
    if (!ticket) return null;
    const [categories, settings] = await Promise.all([db.listCategories(guild.id), settingsDb.getSettings(guild.id)]);
    const category = categories.find((item) => String(item.id) === String(ticket.category_id)) ?? null;
    const channel = ticket.channel_id ? guild.channels?.cache?.get(ticket.channel_id) ?? null : null;
    return { ticket, category, settings, channel };
  }

  function mayAct(access, loaded) {
    const { ticket, category, settings, channel } = loaded;
    if (!canSee(access, channel)) return false;
    return loadActions().isStaffAllowedForTicket(access.member, category ?? { support_role_ids: [] }, ticket, settings);
  }

  // ── one ticket and its last messages
  app.post('/api/dashboard/guild/:guildId/tickets/live/messages', readLimiter, async (req, res) => {
    const access = await authorize(req, res, { page: 'tickets', edit: false });
    if (!access) return;
    const { guild, userId } = access;
    const lang = requestLanguage(req, guild.id);
    const { fail } = reply(res, lang);
    if (limited(`r:${guild.id}:${userId}`, READS)) { fail(429, 'slow_down', 'slowDown'); return; }
    try {
      const loaded = await loadTicket(guild, req.body);
      if (!loaded) { fail(404, 'not_found', 'notFound'); return; }
      const { ticket, category, settings, channel } = loaded;
      if (!canSee(access, channel)) { fail(403, 'no_access', 'noAccess'); return; }
      live.watch(guild.id, [ticket], { add: true });
      const { list, stale } = channel?.messages ? await recentMessages(channel) : { list: [], stale: false };
      const meId = guild.members?.me?.id;
      const added = channel?.permissionOverwrites?.cache
        ? [...channel.permissionOverwrites.cache.values()]
          .filter((overwrite) => overwrite.type === OverwriteType.Member && overwrite.id !== ticket.opener_id && overwrite.id !== meId && overwrite.allow?.has?.(PermissionFlagsBits.ViewChannel))
          .map((overwrite) => overwrite.id)
          .slice(0, 25)
        : [];
      const entry = lastOf(channel);
      const found = await people(guild, [ticket.opener_id, ticket.claimed_by, entry?.authorId, ...added]);
      let canAct = false;
      try { canAct = ticket.status === 'open' && Boolean(channel) && mayAct(access, loaded); } catch { canAct = false; }
      res.json({
        ok: true,
        ticket: {
          ...ticketRow({ ticket, category, channel, entry, found, guild }),
          members: added.map((id) => found.get(id) ?? { id, name: id, avatar: null }),
          canAct,
          claimMode: settings.claim_mode === 'exclusive' ? 'exclusive' : 'shared',
          closeRequiresReason: Boolean(settings.close_requires_reason),
          closedAt: ticket.closed_at ? new Date(ticket.closed_at).toISOString() : null,
        },
        messages: list,
        stale,
        now: new Date(now()).toISOString(),
      });
    } catch (err) {
      logger.error(`Dashboard live ticket messages failed for guild ${req.params.guildId}:`, err);
      fail(500, 'failed');
    }
  });

  // ── what the staff does
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/tickets/live/:action', ...middleware, async (req, res) => {
    const action = String(req.params.action);
    if (!WRITE_ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
    const access = await authorize(req, res, { page: 'tickets', edit: true });
    if (!access) return;
    const { guild, member, userId } = access;
    const lang = requestLanguage(req, guild.id);
    const { fail } = reply(res, lang);
    if (limited(`w:${guild.id}:${userId}`, WRITES)) { fail(429, 'slow_down', 'slowDown'); return; }
    const body = req.body ?? {};
    try {
      const loaded = await loadTicket(guild, body);
      if (!loaded) { fail(404, 'not_found', 'notFound'); return; }
      const { ticket, settings, channel } = loaded;
      if (ticket.status !== 'open') { fail(409, 'not_open', 'notOpen', { number: ticket.ticket_number }); return; }
      if (!channel) { fail(410, 'channel_gone', 'channelGone', { number: ticket.ticket_number }); return; }
      if (!mayAct(access, loaded)) {
        if (settings.claim_mode === 'exclusive' && ticket.claimed_by && ticket.claimed_by !== userId) { fail(403, 'claimed_by_other', 'claimedByOther', { name: personOf(guild, ticket.claimed_by)?.name ?? ticket.claimed_by }); return; }
        fail(403, 'not_staff', 'notStaff');
        return;
      }
      const actions = loadActions();
      const send = loadSend();
      const actor = member?.user ?? { id: userId, username: member?.displayName ?? userId };
      const ctx = { guild, client: guild.client, channel, ticket, actor };
      const serverLang = await serverLanguage(guild.id);
      const notice = (content) => send(channel, FEATURE, { content, allowedMentions: { parse: [] } }).catch(() => null);
      const done = (key, vars = {}, extra = {}) => { live.signal(guild.id); messageCache.delete(channel.id); res.json({ ok: true, message: t(lang, `web.api.ticketLive.${key}`, vars), ...extra }); };

      if (action === 'reply') {
        const content = String(body.content ?? '').replace(/\u0000/g, '').trim();
        if (!content) { fail(400, 'empty', 'emptyReply'); return; }
        if (content.length > MAX_REPLY) { fail(400, 'too_long', 'tooLong', { max: MAX_REPLY }); return; }
        if (limited(`reply:${guild.id}:${userId}`, REPLIES)) { fail(429, 'slow_down', 'slowDown'); return; }
        const me = guild.members?.me;
        if (me && typeof channel.permissionsFor === 'function' && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) { fail(403, 'cannot_send', 'cannotSend'); return; }
        const name = plainName(member?.displayName) || plainName(member?.user?.username) || userId;
        const header = t(serverLang, 'tickets.live.replyHeader', { name });
        // Sent as Petto (or the look the server gave its ticket messages), with the name of who wrote it on top; no one is pinged.
        const sent = await send(channel, FEATURE, { content: `${header}\n${content}`, allowedMentions: { parse: [] } });
        if (sent?.id) live.recordActivity(channel.id, { messageId: String(sent.id), at: Number(sent.createdTimestamp) || now(), authorId: String(sent.author?.id ?? ''), bot: true, staffReply: true, staff: true });
        // The reply is the staff's: it counts for inactivity and the staff's message count, as a message written in Discord would.
        if (settings.autoclose_inactivity_enabled || settings.log_staff_message_counts) await Promise.resolve(touchActivity(ticket.id, { staffMessage: Boolean(settings.log_staff_message_counts) })).catch(() => {});
        logger.info(`Dashboard reply in ticket #${ticket.ticket_number} of guild ${guild.id} by ${userId}.`);
        done('sent', {}, { sent: sent ? live.summarizeMessage(sent) : null });
        return;
      }

      if (action === 'claim') {
        if (ticket.claimed_by) { fail(409, 'already_claimed', 'alreadyClaimed', { name: personOf(guild, ticket.claimed_by)?.name ?? ticket.claimed_by }); return; }
        // The bot's own claim: its card in the ticket says who handles it now (the opener is pinged only when the server asked for it).
        await actions.claimTicket(ctx);
        done('claimed', { number: ticket.ticket_number });
        return;
      }

      if (action === 'unclaim') {
        if (!ticket.claimed_by) { fail(409, 'not_claimed', 'notClaimed'); return; }
        // With the channel, the bot's unclaim posts its card in the ticket, as the button does.
        await actions.unclaimTicket(ctx);
        done('unclaimed', { number: ticket.ticket_number });
        return;
      }

      if (action === 'add' || action === 'remove') {
        const target = targetId(body.target);
        if (!target || !SNOWFLAKE.test(target)) { fail(400, 'bad_target', 'badTarget'); return; }
        if (target === ticket.opener_id) { fail(400, 'is_opener', 'isOpener'); return; }
        if (target === guild.members?.me?.id) { fail(400, 'bad_target', 'badTarget'); return; }
        if (action === 'add') {
          const targetMember = await guild.members.fetch(target).catch(() => null);
          if (!targetMember) { fail(404, 'not_member', 'notMember'); return; }
          await actions.addMember({ ...ctx, targetUser: targetMember.user });
          await notice(t(serverLang, 'tickets.member.added', { emoji: EMOJI.APPROVE, user: `<@${target}>` }));
          done('added', { name: targetMember.displayName ?? targetMember.user?.username ?? target });
          return;
        }
        const targetUser = await guild.client.users.fetch(target).catch(() => null);
        if (!targetUser) { fail(404, 'not_member', 'notMember'); return; }
        await actions.removeMember({ ...ctx, targetUser });
        await notice(t(serverLang, 'tickets.member.removed', { emoji: EMOJI.APPROVE, user: `<@${target}>` }));
        done('removed', { name: targetUser.globalName ?? targetUser.username ?? target });
        return;
      }

      // close: the same as the close button. It makes the transcript and sends the logs, which takes a while on a long ticket: the answer
      // comes when it is done or after a second ("closing"), and the list shows it closed when it is.
      const reason = String(body.reason ?? '').replace(/\u0000/g, '').trim().slice(0, MAX_REASON);
      if (settings.close_requires_reason && !reason) { fail(400, 'reason_required', 'reasonRequired'); return; }
      const job = Promise.resolve()
        .then(() => actions.closeTicket({ ...ctx, reason }))
        .then(() => ({ ok: true }), (err) => {
          if (!err?.userFacing) logger.error(`Dashboard close of ticket #${ticket.ticket_number} failed for guild ${guild.id}:`, err);
          return { ok: false, error: err };
        });
      const outcome = await Promise.race([job, later(CLOSE_WAIT_MS, null)]);
      if (outcome && !outcome.ok) {
        const message = outcome.error?.userFacing ? String(outcome.error.message) : t(lang, 'web.api.ticketLive.failed');
        res.status(400).json({ ok: false, code: 'close_failed', message });
        return;
      }
      done(outcome ? 'closed' : 'closing', { number: ticket.ticket_number }, { pending: !outcome });
    } catch (err) {
      logger.error(`Dashboard live ticket ${action} failed for guild ${req.params.guildId}:`, err);
      fail(500, 'failed');
    }
  });
}

module.exports = { registerTicketLiveRoutes, plainName, targetId, MAX_REPLY };

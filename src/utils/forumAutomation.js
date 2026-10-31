// Forum support: what happens by itself. Posts nobody wrote in for some days are locked or closed, solved posts are locked or closed after a
// few hours, and a post made by hand with no tag (when the setup requires one) is closed when the time to choose one is over. A job asks the
// database once a minute for the few posts that are due (an index, never a walk through every post) and does each one with the same actions as
// the tools. A new post made by hand is adopted (kept, with the guidelines and the question about the tag) when the setup asks for it.
const { ChannelType } = require('discord.js');
const forumsDb = require('../db/forums');
const { ensureGuild } = require('../db/guilds');
const actions = require('./forumActions');
const cards = require('./forumCards');
const { isForumPost } = require('./forumAccess');
const { guildLanguage } = require('../i18n');
const logger = require('./logger');

const PER_RUN = 25;
// A post or server that could not be reached (deleted, no access, the bot left) is left alone for a while, so a few of them never keep the
// others waiting. A small map: at most this many entries, each forgotten after the time.
const SKIP_MS = 60 * 60_000;
const MAX_SKIPPED = 500;
const skipped = new Map(); // `g:<guild>` or `t:<thread>` -> time it may be tried again

const skipKey = (kind, id) => `${kind}:${id}`;
function skip(kind, id, now) {
  if (skipped.size >= MAX_SKIPPED) skipped.delete(skipped.keys().next().value);
  skipped.set(skipKey(kind, id), now + SKIP_MS);
}
function skippedNow(row, now) {
  for (const key of [skipKey('g', row.guild_id), skipKey('t', row.thread_id)]) {
    const until = skipped.get(key);
    if (until === undefined) continue;
    if (until > now) return true;
    skipped.delete(key);
  }
  return false;
}

// What the database asks, written once more in code: the checks compare the two.
const DAY = 86_400_000;
const HOUR = 3_600_000;
const time = (value) => new Date(value).getTime();
/** An open or solved post nobody wrote in for the setup's days. */
const inactiveDue = (post, setup, now) => ['open', 'solved'].includes(post.status) && setup.inactive_days > 0 && time(post.last_activity_at) < now - setup.inactive_days * DAY;
/** A solved post that has waited the setup's hours. */
const solvedDue = (post, setup, now) => post.status === 'solved' && setup.solved_action !== 'none' && post.solved_at != null && time(post.solved_at) < now - setup.solved_delay_hours * HOUR;
/** An open post whose time to get a tag is over. */
const tagDue = (post, now) => post.status === 'open' && post.tag_deadline_at != null && time(post.tag_deadline_at) <= now;

async function threadOf(client, row) {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return { missing: 'guild' };
  try {
    const thread = guild.channels.cache.get(row.thread_id) ?? await guild.channels.fetch(row.thread_id);
    return thread?.isThread?.() ? { guild, thread } : { missing: 'thread' };
  } catch (error) {
    return { missing: error?.code === 10003 ? 'gone' : 'thread' };
  }
}

/**
 * Does one due post. `kind` is `quiet`, `solved` or `tag`; `action` is `lock` or `close`. Returns 'done', 'gone' (the post does not exist any more:
 * the row is deleted), 'skipped' (it could not be done now) or 'cleared' (a tag appeared: nothing to do).
 */
async function handle(client, row, kind, action, now) {
  const found = await threadOf(client, row);
  if (found.missing) {
    if (found.missing === 'gone') { await forumsDb.deletePost(row.thread_id).catch(() => {}); return 'gone'; }
    skip(found.missing === 'guild' ? 'g' : 't', found.missing === 'guild' ? row.guild_id : row.thread_id, now);
    return 'skipped';
  }
  const { guild, thread } = found;
  const setup = await forumsDb.getSetupById(row.setup_id);
  const ctx = { guild, client, thread, forum: thread.parent, setup, post: row, lang: await guildLanguage(guild.id) };
  const lang = ctx.lang;
  try {
    if (kind === 'tag' && (thread.appliedTags ?? []).length) {
      await forumsDb.updatePost(row.thread_id, { tag_deadline_at: null });
      return 'cleared';
    }
    // A post that Discord archived by itself is opened first: an archived post cannot be locked or get a card.
    if (thread.archived && row.status !== 'closed') await thread.setArchived(false);
    const vars = kind === 'quiet' ? { days: setup?.inactive_days ?? 0 } : kind === 'solved' ? { hours: setup?.solved_delay_hours ?? 0 } : { minutes: setup?.tag_wait_minutes ?? 0 };
    const key = kind === 'quiet' ? 'quiet' : kind === 'solved' ? 'solved' : 'noTag';
    const notice = () => thread.send(action === 'close'
      ? cards.buildNotice(`${key}Closed`, vars, { lang })
      : cards.buildNotice(`${key}Locked`, vars, { lang })).catch((error) => logger.warn(`Forums: the notice could not be sent in ${thread.id}: ${error.message}`));
    const automatic = kind === 'tag' ? 'tag' : kind === 'solved' ? 'solved' : 'quiet';
    if (action === 'close') await actions.closePost(ctx, { automatic, announce: notice });
    else { await actions.lockPost(ctx, { automatic }); await notice(); }
    return 'done';
  } catch (error) {
    logger.warn(`Forums: could not ${action} the post ${row.thread_id} (${kind}): ${error.message}`);
    skip('t', row.thread_id, now);
    return 'skipped';
  }
}

/**
 * One pass of the job: the due posts of the three kinds, a few at a time. `deps.db` replaces the database layer and `deps.now` the clock (the
 * checks do). Returns how many posts were done, by kind.
 */
async function runForumJob(client, { deps = {}, now = Date.now() } = {}) {
  const db = deps.db ?? forumsDb;
  const done = { quiet: 0, solved: 0, tag: 0 };
  const jobs = [
    ['quiet', () => db.dueInactive(PER_RUN)],
    ['solved', () => db.dueSolved(PER_RUN)],
    ['tag', () => db.dueTag(PER_RUN)],
  ];
  for (const [kind, load] of jobs) {
    const rows = (await load()).filter((row) => !skippedNow(row, now));
    for (const row of rows) {
      const action = kind === 'tag' ? 'close' : row.action;
      const result = await (deps.handle ?? handle)(client, row, kind, action, now);
      if (result === 'done') done[kind] += 1;
    }
  }
  return done;
}

// ── a post made by hand ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A new post in a forum: kept (with the guidelines and the question about the tag) when its setup adopts posts made by hand. */
async function adoptPost(thread, { now = Date.now() } = {}) {
  if (!isForumPost(thread) || thread.parent?.type !== ChannelType.GuildForum) return null;
  const client = thread.guild.client;
  // The posts Petto makes (the panel, a moved message) belong to it and are kept when they are made.
  if (thread.ownerId && thread.ownerId === client.user.id) return null;
  const setup = await forumsDb.getSetupByForum(thread.guild.id, thread.parentId);
  if (!setup || !setup.enabled || !setup.adopt) return null;
  const lang = await guildLanguage(thread.guild.id);
  await ensureGuild(thread.guild.id).catch(() => null);
  const needsTag = setup.require_tag && (thread.parent.availableTags ?? []).length > 0 && !(thread.appliedTags ?? []).length;
  const post = await forumsDb.upsertPost({
    thread_id: thread.id, guild_id: thread.guild.id, setup_id: setup.id, author_id: String(thread.ownerId ?? client.user.id), title: String(thread.name ?? '').slice(0, 100), status: 'open', source: 'native',
    ...(needsTag ? { tag_deadline_at: new Date(now + setup.tag_wait_minutes * 60_000).toISOString() } : {}),
  });
  const warn = (label) => (error) => logger.warn(`Forums: ${label} in ${thread.id}: ${error.message}`);
  const info = cards.buildInfoCard({ pingText: (setup.ping_role_ids ?? []).map((id) => `<@&${id}>`).join(' '), guidelines: setup.guidelines }, { lang });
  if (info) await thread.send({ ...info, allowedMentions: { parse: [], roles: setup.ping_role_ids ?? [] } }).catch(warn('the guidelines could not be sent')); // i18n-ignore: SQL or log text
  if (needsTag && thread.ownerId) await thread.send(cards.buildTagAsk({ author: thread.ownerId, minutes: setup.tag_wait_minutes, lang })).catch(warn('the question about the tag could not be sent')); // i18n-ignore: SQL or log text
  await actions.logForum({ guild: thread.guild, client, thread, forum: thread.parent, setup, post, lang }, 'opened', { actor: thread.ownerId ?? null });
  return post;
}

module.exports = { PER_RUN, SKIP_MS, MAX_SKIPPED, skipped, inactiveDue, solvedDue, tagDue, handle, runForumJob, adoptPost };

// Forum support: what is done in Discord. Opening a post for a member, locking, closing, solving, renaming and tagging a post, claiming it, moving a
// message into the forum, and posting the panel. The commands, the buttons, the jobs and the dashboard all go through here, so a post closed from
// the dashboard is the same as one closed with `!forum close`. A failure that the person can fix is an error with `userFacing: true` whose message is
// already in their language; the others are Discord's own errors (see describeError).
const { ChannelType, ChannelFlags } = require('discord.js');
const forumsDb = require('../db/forums');
const { ensureGuild } = require('../db/guilds');
const { sendLog } = require('../logging/engine');
const { postAnswers, prepareFiles } = require('./ticketAnswers');
const { templatePayload } = require('./templatedMessage');
const config = require('./forumConfig');
const cards = require('./forumCards');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, guildLanguage, currentLanguage } = require('../i18n');

const AUDIT_MAX = 400;

/** An error whose message is for the person (already in their language). */
function problem(lang, key, vars = {}) {
  const error = new Error(t(lang, key, vars));
  error.userFacing = true;
  error.key = key;
  return error;
}

/** What to tell a person when Discord refused something: the missing permission in plain words, else a short sentence (details stay in the logs). */
function describeError(error, lang = currentLanguage()) {
  if (error?.userFacing) return error.message;
  switch (error?.code) {
    case 50013: return t(lang, 'forums.error.permission');
    case 50001: return t(lang, 'forums.error.access');
    case 10003: case 10008: return t(lang, 'forums.error.gone');
    case 220003: return t(lang, 'forums.error.tagRequired');
    case 160006: case 160005: return t(lang, 'forums.error.locked');
    case 30033: return t(lang, 'forums.error.tooManyTags');
    default: return t(lang, 'forums.error.generic');
  }
}

const reasonText = (lang, key, vars) => t(lang, key, vars).slice(0, AUDIT_MAX);

// ── finding things ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The forum channel of a setup: from memory, else from Discord. Null when it is gone or is not a forum any more. */
async function fetchForum(guild, forumChannelId) {
  const channel = guild.channels.cache.get(forumChannelId) ?? await guild.channels.fetch(forumChannelId).catch(() => null);
  return channel?.type === ChannelType.GuildForum ? channel : null;
}

async function fetchMember(guild, userId) {
  return guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
}

/** What a tool needs to know about the post it runs in: the forum, its setup and the row of the index (null when the post is not kept). */
async function loadContext(thread) {
  const guild = thread.guild;
  const forum = thread.parent;
  const setup = await forumsDb.getSetupByForum(guild.id, forum.id);
  const post = await forumsDb.getPost(thread.id);
  return { guild, client: guild.client, thread, forum, setup, post, lang: await guildLanguage(guild.id) };
}

/** Starts to keep a post that was not kept (a post made by hand, or before the setup): the author is the owner of the thread. */
async function ensurePost(ctx, { source = 'native' } = {}) {
  if (ctx.post) return ctx.post;
  await ensureGuild(ctx.guild.id).catch(() => null);
  const { thread } = ctx;
  ctx.post = await forumsDb.upsertPost({
    thread_id: thread.id, guild_id: ctx.guild.id, setup_id: ctx.setup?.id ?? null, author_id: String(thread.ownerId ?? ctx.client.user.id), title: String(thread.name ?? '').slice(0, 100),
    status: thread.archived ? 'closed' : thread.locked ? 'locked' : 'open', source, opened_at: thread.createdAt?.toISOString?.() ?? new Date().toISOString(), last_activity_at: new Date().toISOString(),
  });
  return ctx.post;
}

/** The names of the permissions the bot lacks in a channel or a post (empty when it has them all). */
function botMissing(channel, names = ['ViewChannel', 'SendMessagesInThreads', 'ManageThreads']) {
  return config.missingPermissions(channel, channel.guild.members.me, names);
}

function requireBotPermissions(ctx, names) {
  const missing = botMissing(ctx.thread ?? ctx.forum, names);
  if (missing.length) throw problem(ctx.lang, 'forums.error.botMissing', { permissions: missing.map((name) => require('./permissionLabels').permissionName(name, ctx.lang)).join(', ') });
}

// ── the log ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LOG_COLORS = { opened: 0xa5ea7a, locked: 0xfed53c, closed: 0xfe6465, solved: 0xa5ea7a };

/** Tells the server log (the `forums` category) about a post, when the setup lets that event through. Never fails the caller. */
async function logForum(ctx, event, { actor = null, reason = null, automatic = null } = {}) {
  try {
    if (ctx.setup && !(ctx.setup.log_events ?? []).includes(event)) return;
    const { lang, thread } = ctx;
    const fields = [{ name: t(lang, 'forums.log.forum'), value: `<#${ctx.forum?.id ?? thread.parentId}>`, inline: true }];
    const authorId = ctx.post?.author_id ?? thread.ownerId;
    if (authorId) fields.push({ name: t(lang, 'forums.log.author'), value: `<@${authorId}>`, inline: true });
    if (actor) fields.push({ name: t(lang, 'forums.log.by'), value: `<@${actor}>`, inline: true });
    else if (automatic) fields.push({ name: t(lang, 'forums.log.by'), value: t(lang, `forums.log.auto.${automatic}`), inline: true });
    if (reason) fields.push({ name: t(lang, 'forums.log.reason'), value: String(reason).slice(0, 500), inline: false });
    await sendLog(ctx.client, ctx.guild.id, 'forums', {
      author: { name: t(lang, `forums.log.${event}.title`) },
      description: t(lang, `forums.log.${event}.description`, { post: `<#${thread.id}>`, title: String(thread.name ?? '').slice(0, 100) }),
      color: LOG_COLORS[event],
      fields,
      footer: { text: t(lang, 'forums.log.footer', { id: thread.id }) },
      timestamp: new Date().toISOString(),
    }, { ignoreIds: [thread.id, thread.parentId, authorId].filter(Boolean) });
  } catch (error) {
    logger.warn(`Forums: could not write the log: ${error.message}`);
  }
}

// ── opening a post ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Why a member cannot open a post now, as an error that says it, or null. Reads what the index knows (their open posts, their last one).
 * `deps.state` replaces the read (the checks do).
 */
async function refusalFor(setup, member, lang, { deps = {}, now = Date.now() } = {}) {
  const state = deps.state ? await deps.state() : await forumsDb.memberState(setup.id, member.id);
  const refusal = config.checkEligibility(setup, member, { open: state.open, lastOpenedAt: state.lastOpenedAt, now });
  return refusal ? problem(lang, `forums.refuse.${refusal.code}`, refusal.vars) : null;
}

/**
 * The tags a post may get, checked: every id must be one the member could pick, no more than the setup allows, and at least one when the setup
 * (or the forum itself) requires it and there is something to pick. Returns the ids.
 */
function checkTags({ forum, setup, tagIds, canModerate, lang }) {
  const choices = config.tagChoices(forum, setup, { canModerate });
  const chosen = [...new Set(tagIds)];
  if (chosen.some((id) => !choices.some((tag) => tag.id === id))) throw problem(lang, 'forums.error.tagGone');
  if (chosen.length > setup.max_tags) throw problem(lang, 'forums.error.tooManyTags');
  const forumRequires = Boolean(forum?.flags?.has?.(ChannelFlags.RequireTag));
  if ((setup.require_tag || forumRequires) && choices.length && !chosen.length) throw problem(lang, 'forums.error.tagRequired');
  return chosen;
}

/**
 * Opens a post for a member: the checks again (the limits can change while the form is open), the files copied, the post created with its tag,
 * the index written, then the answers of the other questions and the card with the roles to ping and the guidelines. Returns { thread, post }.
 */
async function openPost({ guild, client = guild.client, setup, member, title, description, entries = [], tagIds = [], lang, deps = {} }) {
  lang ??= await guildLanguage(guild.id);
  if (!setup?.enabled) throw problem(lang, 'forums.refuse.disabled');
  const forum = await fetchForum(guild, setup.forum_channel_id);
  if (!forum) throw problem(lang, 'forums.error.forumGone');
  const missing = botMissing(forum, config.REQUIRED_PERMISSIONS);
  if (missing.length) throw problem(lang, 'forums.error.botMissing', { permissions: missing.map((name) => require('./permissionLabels').permissionName(name, lang)).join(', ') });
  const refused = await refusalFor(setup, member, lang, { deps });
  if (refused) throw refused;
  const canModerate = Boolean(forum.permissionsFor(member)?.has('ManageThreads'));
  const chosen = checkTags({ forum, setup, tagIds, canModerate, lang });

  const { refused: badFile } = await prepareFiles(entries, { guild, download: deps.download });
  if (badFile) throw problem(lang, 'forums.error.notImage', { emoji: EMOJI.DENY, field: badFile.label, file: String(badFile.name).slice(0, 60) });

  const tags = chosen.map((id) => forum.availableTags.find((tag) => tag.id === id)?.name).filter(Boolean).join(', ');
  const user = `<@${member.id}>`;
  const text = config.firstMessageText(setup, { user, username: member.displayName ?? member.user?.username ?? '', title, description, tags, server: guild.name, forum: `<#${forum.id}>`, lang });
  const thread = await forum.threads.create({
    name: title.slice(0, config.THREAD_NAME_MAX),
    // The author is mentioned so Discord adds them to the post: they hear about the answers.
    message: { content: text, allowedMentions: { parse: [], users: [member.id] } },
    ...(chosen.length ? { appliedTags: chosen } : {}),
    ...(setup.slowmode_seconds > 0 ? { rateLimitPerUser: setup.slowmode_seconds } : {}),
    reason: reasonText(lang, 'forums.audit.opened', { user: member.user?.tag ?? member.id }),
  });
  await ensureGuild(guild.id).catch(() => null);
  let post = null;
  try {
    post = await forumsDb.upsertPost({ thread_id: thread.id, guild_id: guild.id, setup_id: setup.id, author_id: member.id, title: title.slice(0, 100), status: 'open', source: 'panel' });
  } catch (error) {
    logger.warn(`Forums: the post ${thread.id} was created but could not be kept: ${error.message}`);
  }

  const warn = (label) => (error) => logger.warn(`Forums: ${label} in ${thread.id}: ${error.message}`);
  if (setup.first_message_style === 'card') await thread.send(cards.buildDescriptionCard(description)).catch(warn('the description card could not be sent')); // i18n-ignore: SQL or log text
  if (entries.length) {
    await postAnswers(entries, { send: (payload) => thread.send(payload), lang, guild, log: warn('the answers could not be sent') }); // i18n-ignore: SQL or log text
  }
  const pingText = (setup.ping_role_ids ?? []).map((id) => `<@&${id}>`).join(' ');
  const info = cards.buildInfoCard({ pingText, guidelines: setup.guidelines }, { lang });
  if (info) await thread.send({ ...info, allowedMentions: { parse: [], roles: setup.ping_role_ids ?? [] } }).catch(warn('the guidelines could not be sent')); // i18n-ignore: SQL or log text

  const ctx = { guild, client, thread, forum, setup, post, lang };
  await logForum(ctx, 'opened', { actor: member.id });
  return { thread, post };
}

// ── the tools ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const stamp = () => new Date().toISOString();

/** Locks a post (only moderators can write in it). */
async function lockPost(ctx, { actor = null, reason = null, automatic = null } = {}) {
  const { thread, lang } = ctx;
  if (thread.archived) throw problem(lang, 'forums.error.isClosed');
  if (thread.locked) throw problem(lang, 'forums.error.alreadyLocked');
  requireBotPermissions(ctx);
  await ensurePost(ctx);
  await thread.setLocked(true, reasonText(lang, 'forums.audit.locked', { user: actor ?? t(lang, 'forums.log.auto.' + (automatic ?? 'quiet')) }));
  ctx.post = await forumsDb.transition(thread.id, ['open', 'solved'], { status: 'locked' }) ?? ctx.post;
  await logForum(ctx, 'locked', { actor, reason, automatic });
  return ctx.post;
}

/** Lets members write in a locked post again. A closed post (archived) is opened with `reopenPost`. */
async function unlockPost(ctx, { actor = null } = {}) {
  const { thread, lang } = ctx;
  if (thread.archived) throw problem(lang, 'forums.error.isClosed');
  if (!thread.locked && ctx.post?.status !== 'locked') throw problem(lang, 'forums.error.notLocked');
  requireBotPermissions(ctx);
  await ensurePost(ctx);
  await thread.setLocked(false, reasonText(lang, 'forums.audit.unlocked', { user: actor ?? '-' }));
  ctx.post = await forumsDb.updatePost(thread.id, { status: ctx.post?.solved_at ? 'solved' : 'open', last_activity_at: stamp() }) ?? ctx.post;
  return ctx.post;
}

/**
 * Closes a post: locked and archived. `announce` runs after it is locked and before it is archived (an archived post cannot get a message
 * without opening again), so the card that says it is closed is the last message.
 */
async function closePost(ctx, { actor = null, reason = null, automatic = null, announce = null } = {}) {
  const { thread, lang } = ctx;
  if (thread.archived && ctx.post?.status === 'closed') throw problem(lang, 'forums.error.alreadyClosed');
  requireBotPermissions(ctx);
  await ensurePost(ctx);
  const by = actor ?? t(lang, `forums.log.auto.${automatic ?? 'quiet'}`);
  if (thread.archived) await thread.setArchived(false, reasonText(lang, 'forums.audit.closed', { user: by }));
  if (!thread.locked) await thread.setLocked(true, reasonText(lang, 'forums.audit.closed', { user: by }));
  ctx.post = await forumsDb.transition(thread.id, ['open', 'solved', 'locked'], { status: 'closed', closed_at: stamp(), tag_deadline_at: null }) ?? ctx.post;
  if (announce) await announce();
  await thread.setArchived(true, reasonText(lang, 'forums.audit.closed', { user: by }));
  await logForum(ctx, 'closed', { actor, reason, automatic });
  return ctx.post;
}

/** Opens a closed or locked post again. */
async function reopenPost(ctx, { actor = null } = {}) {
  const { thread, lang } = ctx;
  if (!thread.archived && !thread.locked && ['open', 'solved'].includes(ctx.post?.status ?? 'open')) throw problem(lang, 'forums.error.notClosed');
  requireBotPermissions(ctx);
  await ensurePost(ctx);
  const why = reasonText(lang, 'forums.audit.reopened', { user: actor ?? '-' });
  if (thread.archived) await thread.setArchived(false, why);
  if (thread.locked) await thread.setLocked(false, why);
  ctx.post = await forumsDb.updatePost(thread.id, { status: ctx.post?.solved_at ? 'solved' : 'open', closed_at: null, last_activity_at: stamp() }) ?? ctx.post;
  return ctx.post;
}

/** The tag that means solved, made when the forum has none and the bot may edit the forum. Null when there is none and it cannot be made. */
async function ensureSolvedTag(forum, setup, lang) {
  const found = config.solvedTagOf(forum, setup);
  if (found) return found;
  if ((forum.availableTags ?? []).length >= 20) return null;
  if (botMissing(forum, ['ManageChannels']).length) return null;
  const name = t(lang, 'forums.solvedTagName');
  await forum.setAvailableTags([...forum.availableTags.map((tag) => ({ id: tag.id, name: tag.name, moderated: tag.moderated, emoji: tag.emoji })), { name, moderated: true, emoji: { id: null, name: '✅' } }], reasonText(lang, 'forums.audit.solvedTag', { user: '-' }));
  return config.solvedTagOf(forum, setup);
}

/** Marks a post solved: the Solved tag goes on it and the state changes. The lock or close that may follow is for the job (see forumAutomation.js). */
async function solvePost(ctx, { actor = null } = {}) {
  const { thread, forum, setup, lang } = ctx;
  if (ctx.post?.solved_at) throw problem(lang, 'forums.error.alreadySolved');
  requireBotPermissions(ctx);
  const tag = await ensureSolvedTag(forum, setup, lang);
  if (!tag) throw problem(lang, 'forums.error.noSolvedTag');
  await ensurePost(ctx);
  const applied = thread.appliedTags ?? [];
  if (!applied.includes(tag.id)) {
    // A post holds five tags at most: the Solved tag takes the place of the last one.
    const next = [...applied.slice(0, 4), tag.id];
    await thread.setAppliedTags(next, reasonText(lang, 'forums.audit.solved', { user: actor ?? '-' }));
  }
  const solvedAt = stamp();
  ctx.post = await forumsDb.transition(thread.id, ['open'], { status: 'solved', solved_at: solvedAt })
    ?? await forumsDb.transition(thread.id, ['locked', 'closed'], { solved_at: solvedAt }) ?? ctx.post;
  await logForum(ctx, 'solved', { actor });
  return { post: ctx.post, tag };
}

/** Takes the Solved tag off a post and marks it open again. */
async function unsolvePost(ctx, { actor = null } = {}) {
  const { thread, forum, setup, lang } = ctx;
  if (!ctx.post?.solved_at) throw problem(lang, 'forums.error.notSolved');
  requireBotPermissions(ctx);
  const tag = config.solvedTagOf(forum, setup);
  if (tag && (thread.appliedTags ?? []).includes(tag.id)) await thread.setAppliedTags(thread.appliedTags.filter((id) => id !== tag.id), reasonText(lang, 'forums.audit.unsolved', { user: actor ?? '-' }));
  ctx.post = await forumsDb.transition(thread.id, ['solved'], { status: 'open', solved_at: null, last_activity_at: stamp() })
    ?? await forumsDb.updatePost(thread.id, { solved_at: null }) ?? ctx.post;
  return ctx.post;
}

/** Gives a post a new title (the name of the thread). */
async function renamePost(ctx, title, { actor = null } = {}) {
  const { thread, lang } = ctx;
  const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, config.THREAD_NAME_MAX);
  if (!name) throw problem(lang, 'forums.error.needsTitle');
  requireBotPermissions(ctx);
  await ensurePost(ctx);
  await thread.setName(name, reasonText(lang, 'forums.audit.renamed', { user: actor ?? '-' }));
  ctx.post = await forumsDb.updatePost(thread.id, { title: name }) ?? ctx.post;
  return name;
}

/** Puts a tag of the forum on a post (by its name or id). */
async function addTag(ctx, reference, { actor = null } = {}) {
  const { thread, forum, lang } = ctx;
  const tag = config.findTag(forum.availableTags ?? [], reference);
  if (!tag) throw problem(lang, 'forums.error.tagUnknown', { tag: String(reference ?? '').slice(0, 60) });
  const applied = thread.appliedTags ?? [];
  if (applied.includes(tag.id)) throw problem(lang, 'forums.error.tagHas', { tag: tag.name });
  if (applied.length >= 5) throw problem(lang, 'forums.error.tooManyTags');
  requireBotPermissions(ctx);
  await thread.setAppliedTags([...applied, tag.id], reasonText(lang, 'forums.audit.tagAdded', { user: actor ?? '-', tag: tag.name }));
  return tag;
}

/** Takes a tag off a post. */
async function removeTag(ctx, reference, { actor = null } = {}) {
  const { thread, forum, lang } = ctx;
  const applied = (forum.availableTags ?? []).filter((tag) => (thread.appliedTags ?? []).includes(tag.id));
  const tag = config.findTag(applied, reference);
  if (!tag) throw problem(lang, 'forums.error.tagNotOn', { tag: String(reference ?? '').slice(0, 60) });
  requireBotPermissions(ctx);
  await thread.setAppliedTags(thread.appliedTags.filter((id) => id !== tag.id), reasonText(lang, 'forums.audit.tagRemoved', { user: actor ?? '-', tag: tag.name }));
  return tag;
}

/** The staff member who handles a post. A second one cannot take it from the first unless they moderate threads. */
async function claimPost(ctx, { actor, moderator = false } = {}) {
  const { thread, lang } = ctx;
  await ensurePost(ctx);
  if (ctx.post.claimed_by === actor) throw problem(lang, 'forums.error.claimedByYou');
  if (ctx.post.claimed_by && !moderator) throw problem(lang, 'forums.error.claimedByOther', { user: `<@${ctx.post.claimed_by}>` });
  ctx.post = await forumsDb.updatePost(thread.id, { claimed_by: actor }) ?? ctx.post;
  return ctx.post;
}

async function unclaimPost(ctx, { actor, moderator = false } = {}) {
  const { thread, lang } = ctx;
  if (!ctx.post?.claimed_by) throw problem(lang, 'forums.error.notClaimed');
  if (ctx.post.claimed_by !== actor && !moderator) throw problem(lang, 'forums.error.claimedByOther', { user: `<@${ctx.post.claimed_by}>` });
  ctx.post = await forumsDb.updatePost(thread.id, { claimed_by: null }) ?? ctx.post;
  return ctx.post;
}

// ── moving a message into the forum ────────────────────────────────────────────────────────────────────────────────────

/** A title for a moved message: the first line of what it said, else a line with the name of the member. */
function titleFromMessage(message, lang) {
  const first = String(message.content ?? '').split('\n').map((line) => line.replace(/<[@#&!]*\d+>|https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim()).find(Boolean);
  return (first ? first.slice(0, 80) : t(lang, 'forums.move.defaultTitle', { user: message.member?.displayName ?? message.author?.username ?? '' })).slice(0, config.THREAD_NAME_MAX);
}

/**
 * Turns a message of a normal channel into a post of the forum of `setup`: the first message says who wrote it and what it said, a card
 * says who moved it and where to ask next time. The message stays where it is. Returns { thread }.
 */
async function movePost({ guild, setup, message, staff, title = null, lang }) {
  lang ??= await guildLanguage(guild.id);
  const forum = await fetchForum(guild, setup.forum_channel_id);
  if (!forum) throw problem(lang, 'forums.error.forumGone');
  const missing = botMissing(forum, config.REQUIRED_PERMISSIONS);
  if (missing.length) throw problem(lang, 'forums.error.botMissing', { permissions: missing.map((name) => require('./permissionLabels').permissionName(name, lang)).join(', ') });
  const files = [...(message.attachments?.values?.() ?? [])].slice(0, 5).map((file) => file.url);
  const body = [String(message.content ?? '').trim(), ...files].filter(Boolean).join('\n');
  if (!body) throw problem(lang, 'forums.error.moveEmpty');
  const name = String(title ?? '').trim() || titleFromMessage(message, lang);
  const head = t(lang, 'forums.move.starter', { user: `<@${message.author.id}>`, channel: `<#${message.channelId}>` });
  const content = `${head}\n\n${body}`.slice(0, 2000);
  const thread = await forum.threads.create({
    name: name.slice(0, config.THREAD_NAME_MAX),
    message: { content, allowedMentions: { parse: [], users: [message.author.id] } },
    ...(setup.slowmode_seconds > 0 ? { rateLimitPerUser: setup.slowmode_seconds } : {}),
    reason: reasonText(lang, 'forums.audit.moved', { user: staff.user?.tag ?? staff.id }),
  });
  await ensureGuild(guild.id).catch(() => null);
  const post = await forumsDb.upsertPost({ thread_id: thread.id, guild_id: guild.id, setup_id: setup.id, author_id: message.author.id, title: name.slice(0, 100), status: 'open', source: 'moved' }).catch((error) => {
    logger.warn(`Forums: the moved post ${thread.id} could not be kept: ${error.message}`);
    return null;
  });
  await thread.send(cards.buildOriginal({ author: message.author.id, channelId: message.channelId, content: body, staff: staff.id, forumId: forum.id, lang })).catch((error) => logger.warn(`Forums: the card of the moved message could not be sent: ${error.message}`));
  await logForum({ guild, client: guild.client, thread, forum, setup, post, lang }, 'opened', { actor: staff.id });
  return { thread, post };
}

// ── the panel ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The message of the panel of a setup (its saved design when it has one, else the usual card) as the payload to send or edit. */
async function renderPanelMessage(guild, setup, lang) {
  lang ??= await guildLanguage(guild.id);
  const forum = await fetchForum(guild, setup.forum_channel_id);
  const design = setup.panel_template ? await templatePayload(guild.id, setup.panel_template, { guild, lang }) : null;
  if (setup.panel_template && !design) return { error: 'noDesign' };
  return { payload: cards.buildPanel(setup, { forum, lang, design }), forum };
}

/**
 * Posts the panel of a setup in `channel` (the one saved in the setup when none is given). When the panel is already posted there, that message
 * is edited; when it is somewhere else, a new one is posted and the old one deleted. Returns { ok, message, edited } or { ok: false, error }.
 */
async function postPanel({ guild, setup, channel = null, lang }) {
  lang ??= await guildLanguage(guild.id);
  const target = channel ?? (setup.panel_channel_id ? (guild.channels.cache.get(setup.panel_channel_id) ?? await guild.channels.fetch(setup.panel_channel_id).catch(() => null)) : null);
  if (!target) return { ok: false, error: 'noChannel' };
  if (!target.isTextBased?.() || target.isThread?.() || !target.send) return { ok: false, error: 'notText' };
  const me = guild.members.me;
  const allowed = target.permissionsFor?.(me);
  if (allowed && !(allowed.has('ViewChannel') && allowed.has('SendMessages'))) return { ok: false, error: 'noPermission' };
  const rendered = await renderPanelMessage(guild, setup, lang);
  if (rendered.error) return { ok: false, error: rendered.error };
  if (!rendered.forum) return { ok: false, error: 'forumGone' };
  const { payload } = rendered;

  const oldChannelId = setup.panel_channel_id;
  const oldMessageId = setup.panel_message_id;
  const botId = guild.client.user.id;
  let message = null;
  let edited = false;
  if (oldMessageId && oldChannelId === target.id) {
    const old = await target.messages.fetch(oldMessageId).catch(() => null);
    if (old && old.author?.id === botId) {
      // A message that was a classic one cannot become a Components V2 one (or the other way round): then a new one is posted.
      message = await old.edit(payload).catch(() => null);
      edited = Boolean(message);
    }
  }
  if (!message) {
    message = await target.send(payload);
    if (oldMessageId) {
      const oldChannel = oldChannelId === target.id ? target : (guild.channels.cache.get(oldChannelId) ?? null);
      const old = oldChannel?.messages ? await oldChannel.messages.fetch(oldMessageId).catch(() => null) : null;
      if (old && old.author?.id === botId && old.id !== message.id) await old.delete().catch(() => {});
    }
  }
  const saved = await forumsDb.updateSetup(guild.id, setup.id, { panel_channel_id: target.id, panel_message_id: message.id }).catch(() => null);
  return { ok: true, message, edited, setup: saved ?? { ...setup, panel_channel_id: target.id, panel_message_id: message.id } };
}

/** Draws the panel message again (the button of a setup that was turned off, a new text). Only edits the message that is posted: nothing is sent. */
async function refreshPanel(guild, setup, lang) {
  if (!setup?.panel_channel_id || !setup.panel_message_id) return false;
  const channel = guild.channels.cache.get(setup.panel_channel_id) ?? await guild.channels.fetch(setup.panel_channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(setup.panel_message_id).catch(() => null) : null;
  if (!message || message.author?.id !== guild.client.user.id) return false;
  const rendered = await renderPanelMessage(guild, setup, lang);
  if (rendered.error || !rendered.forum) return false;
  return Boolean(await message.edit(rendered.payload).catch(() => null));
}

module.exports = {
  refreshPanel, problem, describeError, fetchForum, fetchMember, loadContext, ensurePost, botMissing, requireBotPermissions, logForum, refusalFor, checkTags, openPost, lockPost, unlockPost, closePost, reopenPost,
  ensureSolvedTag, solvePost, unsolvePost, renamePost, addTag, removeTag, claimPost, unclaimPost, titleFromMessage, movePost, renderPanelMessage, postPanel,
};

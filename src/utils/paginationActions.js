// What `!pagination`, its buttons and the dashboard do in Discord with a paginated message: find it, draw a page on it, post a new
// one, take its buttons off. The rules of the pages are in ./pagination.js, the rows in ../db/paginations.js.
const { MessageFlags } = require('discord.js');
const db = require('../db/paginations');
const { getTemplate } = require('../db/embedTemplates');
const { renderPage, withoutNav, missingBotPermissions } = require('./pagination');
const logger = require('./logger');

// Discord's answers for a message or a channel that is gone, and for one Petto cannot see.
const GONE_CODES = new Set([10003, 10008]);
const NO_ACCESS_CODES = new Set([50001, 50013]);

/** The channel and message of a record. `{ channel, message }`, or `{ error }`: `gone` (and the record is removed) or `noAccess`. */
async function fetchRecordMessage(client, record) {
  const guild = client.guilds.cache.get(record.guild_id);
  if (!guild) return { error: 'noAccess' };
  let channel = guild.channels.cache.get(record.channel_id) ?? null;
  if (!channel) {
    try {
      channel = await guild.channels.fetch(record.channel_id);
    } catch (err) {
      if (GONE_CODES.has(err?.code)) { await db.deletePagination(record).catch(() => {}); return { error: 'gone' }; }
      return { error: 'noAccess' };
    }
  }
  if (!channel?.messages) { await db.deletePagination(record).catch(() => {}); return { error: 'gone' }; }
  try {
    const message = await channel.messages.fetch(record.message_id);
    return { channel, message };
  } catch (err) {
    if (GONE_CODES.has(err?.code)) { await db.deletePagination(record).catch(() => {}); return { error: 'gone' }; }
    return { error: NO_ACCESS_CODES.has(err?.code) ? 'noAccess' : 'failed', detail: err?.message };
  }
}

/** The member the variables of a shared page are filled for: who made the pagination, or `fallback` when they left. */
async function ownerMember(guild, record, fallback = null) {
  if (record.created_by) {
    const member = guild.members.cache.get(record.created_by) ?? await guild.members.fetch(record.created_by).catch(() => null);
    if (member) return member;
  }
  return fallback ?? guild.members.me;
}

/** The context the variables of a page are filled with. */
function pageContext(guild, channel, member, lang) {
  return { guild, channel, member, user: member?.user ?? null, lang };
}

/** Draws page `index` of a record on its message, for everyone. `{ ok, page }` or `{ error, vars? }`. */
async function showPage(client, record, index, { lang, member = null } = {}) {
  const found = await fetchRecordMessage(client, record);
  if (found.error) return found;
  const { channel, message } = found;
  const who = member ?? await ownerMember(channel.guild, record);
  const rendered = await renderPage(record, index, pageContext(channel.guild, channel, who, lang), { getTemplate, navLang: lang });
  if (rendered.error) return rendered;
  try {
    await message.edit(rendered.payload);
  } catch (err) {
    logger.warn(`[pagination] could not edit ${record.message_id} in ${record.guild_id}: ${err?.message ?? err}`);
    return { error: 'editFailed', vars: { error: err?.message ?? String(err) } };
  }
  return { ok: true, page: rendered.page, message };
}

/**
 * Posts a new paginated message in `channel` with the given pages (all already checked), and saves it. The message is sent with
 * its first page, then the buttons are put on it once the record (whose id they carry) exists.
 */
async function postPagination(channel, { pages, kind, isPrivate = false, member, lang }) {
  const missing = missingBotPermissions(channel, channel.guild.members.me, { send: true });
  if (missing.length) return { error: 'botPermissions', vars: { permissions: missing } };
  const draft = { id: '0', kind, pages: pages.slice(0, 1) };
  const first = await renderPage(draft, 0, pageContext(channel.guild, channel, member, lang), { getTemplate, navLang: lang });
  if (first.error) return first;
  let message;
  try {
    const { attachments, ...payload } = first.payload;
    message = await channel.send(payload);
  } catch (err) {
    return { error: 'sendFailed', vars: { error: err?.message ?? String(err) } };
  }
  const record = await db.createPagination({ guildId: channel.guild.id, channelId: channel.id, messageId: message.id, kind, pages, isPrivate, postedByPetto: true, createdBy: member?.id ?? null });
  if (pages.length > 1) {
    const shown = await showPage(channel.client, record, 0, { lang, member });
    if (shown.error) return { record, message, warning: shown };
  }
  return { record, message };
}

/** Takes the buttons of a pagination off its message (the page shown stays). Best effort: false when the message cannot be changed. */
async function stripButtons(client, record) {
  const found = await fetchRecordMessage(client, record);
  if (found.error) return false;
  const { message } = found;
  const v2 = Boolean(message.flags?.has?.(MessageFlags.IsComponentsV2));
  const components = withoutNav(message.components ?? []);
  if (components.length === (message.components ?? []).length) return true;
  if (v2 && !components.length) return false;
  try {
    await message.edit({ components, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

module.exports = { fetchRecordMessage, ownerMember, pageContext, showPage, postPagination, stripButtons };

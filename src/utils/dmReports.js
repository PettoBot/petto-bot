// i18n-ignore-file: the card of the Petto team (they read English); what the reporter reads comes from the catalog in interactions/dmOrigin.js.
// A person reports a direct message that Petto sent them. It goes to the PETTO team (the channel PETTO_DM_REPORTS_CHANNEL_ID of the operations
// server), never to the moderators of the server the message came from. The report is stored first (table dm_reports): when no channel is set, or
// Discord refuses the card, the report waits in the database and a warning is logged, so nothing is lost.
//
// Limits: 20 to 1000 characters of details, a category from the list, 3 reports an hour for each person and ONE report for each message (both
// counted in memory, so two clicks at once cannot pass, and in the database, so a restart does not reset them).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const logger = require('./logger');
const { addBlocks } = require('./cardBlocks');
const { COLORS } = require('./colors');
const { isDmReportCategory } = require('./reportCategories');
const { TEAM_PREFIX } = require('./dmOrigin');

const LIMITS = Object.freeze({ min: 20, max: 1000, perHour: 3, windowSeconds: 3600, snapshot: 1200 });

/** Links and invites made harmless to click (`hxxps://example[.]com/x`, `discord[.]gg/x`): the team reads them, nobody opens them by accident. */
function defang(text) {
  return String(text ?? '')
    .replace(/\b(https?):\/\/([^\s<>)\]]+)/gi, (match, scheme, rest) => `${scheme.replace(/tt/i, 'xx')}://${rest.replace(/\./g, '[.]')}`)
    .replace(/\bdiscord(?:app)?\.(gg|com)\b/gi, (match) => match.replace('.', '[.]'));
}

const json = (component) => (typeof component?.toJSON === 'function' ? component.toJSON() : component);

/** The words of a message of Petto: its text, its embeds and the texts of its components, one line each. */
function messageText(message) {
  const parts = [];
  if (message?.content) parts.push(message.content);
  for (const embed of message?.embeds ?? []) {
    const data = json(embed) ?? embed;
    if (data.title) parts.push(data.title);
    if (data.description) parts.push(data.description);
    for (const field of data.fields ?? []) parts.push(`${field.name}: ${field.value}`);
  }
  const walk = (node) => {
    const data = json(node);
    if (!data || typeof data !== 'object') return;
    if (typeof data.content === 'string' && data.content) parts.push(data.content);
    for (const child of data.components ?? []) walk(child);
    if (data.accessory) walk(data.accessory);
  };
  for (const component of message?.components ?? []) walk(component);
  return parts.join('\n');
}

/** What the team is shown of the reported message: links defanged, ``` made harmless, clipped. */
function snapshotOf(message) {
  const flat = defang(messageText(message)).replace(/```/g, "'''").trim();
  return flat.length > LIMITS.snapshot ? `${flat.slice(0, LIMITS.snapshot - 1)}…` : flat;
}

const oneLine = (value, max) => String(value ?? '').replace(/[\r\n`]+/g, ' ').trim().slice(0, max);

/** The card of the team: what was reported, where it came from, who reported it, and the button that marks it handled. No mention can notify anyone. */
function teamCard(row, { handledBy = null } = {}) {
  const handled = row.status === 'handled' || Boolean(handledBy);
  const seconds = Math.floor(new Date(row.created_at ?? Date.now()).getTime() / 1000);
  const origin = row.guild_id ? `${oneLine(row.guild_name, 100) || 'unknown'} (\`${row.guild_id}\`)` : 'Petto itself (no server)';
  const text = [
    `### DM report #${row.id} · ${oneLine(row.category, 40)}`,
    `**From server:** ${origin}\n**Kind:** \`${oneLine(row.kind, 20)}\`\n**Reporter:** \`${oneLine(row.reporter_id, 25)}\` (\`${oneLine(row.reporter_tag, 40) || 'unknown'}\`)\n**When:** <t:${seconds}:R>\n**DM deleted by the reporter:** ${row.deleted_dm ? 'yes' : 'no'}${handled ? `\n**Handled by:** \`${oneLine(handledBy ?? row.handled_by, 25)}\`` : ''}`,
    `### The reported message\n\`\`\`\n${(row.message_text ?? '').slice(0, LIMITS.snapshot) || '(no text)'}\n\`\`\``,
    `### Details from the reporter\n\`\`\`\n${String(row.details ?? '').replace(/```/g, "'''").slice(0, LIMITS.max)}\n\`\`\``,
  ].join('\n');
  const container = addBlocks(new ContainerBuilder(), text).setAccentColor(handled ? COLORS.GREEN : COLORS.YELLOW);
  const button = handled
    ? new ButtonBuilder().setCustomId(`${TEAM_PREFIX}:open:${row.id}`).setLabel('Reopen').setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder().setCustomId(`${TEAM_PREFIX}:done:${row.id}`).setLabel('Mark handled').setStyle(ButtonStyle.Success);
  return { components: [container, new ActionRowBuilder().addComponents(button)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/**
 * Sends the card to the team's channel. Returns the id of the card's message, or null when there is no channel or it could not be sent (a warning
 * says which). It never throws: the report is already stored.
 */
async function deliverToTeam(client, row, { channelId = config.opsChannels?.dmReports } = {}) {
  if (!channelId) {
    logger.warn({ action: 'dm-report' }, `DM report #${row.id} is stored, but PETTO_DM_REPORTS_CHANNEL_ID is not set: the team has no channel to read it in.`);
    return null;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.() || !channel.send) throw new Error('it is not a text channel');
    const sent = await channel.send(teamCard(row));
    return sent?.id ?? null;
  } catch (error) {
    logger.warn({ action: 'dm-report' }, `DM report #${row.id} is stored, but the card could not be sent to ${channelId}: ${error.message}`);
    return null;
  }
}

/** The reports of the last hour, in memory: how many each person made and which messages were reported. Bounded, and forgotten with time. */
function createLimiter({ now = () => Date.now() } = {}) {
  const byUser = new Map();
  const messages = new Map();
  const windowMs = LIMITS.windowSeconds * 1000;
  const fresh = (list) => list.filter((at) => now() - at < windowMs);
  return {
    /** Reserves one report for `userId` on `messageId`: `{ ok: true }`, or `{ ok: false, reason: 'limit' | 'duplicate', minutes }`. */
    claim(userId, messageId) {
      if (messages.has(messageId)) return { ok: false, reason: 'duplicate' };
      const list = fresh(byUser.get(userId) ?? []);
      if (list.length >= LIMITS.perHour) return { ok: false, reason: 'limit', minutes: Math.max(1, Math.ceil((list[0] + windowMs - now()) / 60000)) };
      list.push(now());
      byUser.set(userId, list);
      messages.set(messageId, now());
      if (messages.size > 5000) for (const [id, at] of messages) if (now() - at > windowMs * 24) messages.delete(id);
      if (byUser.size > 5000) for (const [id, list2] of byUser) if (!fresh(list2).length) byUser.delete(id);
      return { ok: true };
    },
    /** Gives the reservation back (the report was not stored). */
    release(userId, messageId) {
      const list = byUser.get(userId) ?? [];
      list.pop();
      byUser.set(userId, list);
      messages.delete(messageId);
    },
  };
}

const limiter = createLimiter();

/**
 * Validates, limits, stores and delivers a report. `report`: { user, message, guild: { id, name } | null, kind, category, details, deleteAfter }.
 * Returns `{ ok: false, reason, ...}` (reason: tooShort, badCategory, limit, duplicate, failed) or `{ ok: true, id, delivered, deleted }`.
 * `deps` lets a check give its own database, limiter and channel.
 */
async function submitDmReport({ client, user, message, guild = null, kind = 'notice', category, details, deleteAfter = false }, deps = {}) {
  const db = deps.db ?? require('../db/dmReports');
  const memory = deps.limiter ?? limiter;
  const text = String(details ?? '').trim();
  if (text.length < LIMITS.min || text.length > LIMITS.max) return { ok: false, reason: 'tooShort', min: LIMITS.min, max: LIMITS.max };
  if (!isDmReportCategory(category)) return { ok: false, reason: 'badCategory' };

  const claim = memory.claim(user.id, message.id);
  if (!claim.ok) return { ok: false, reason: claim.reason, minutes: claim.minutes, max: LIMITS.perHour };
  let row = null;
  try {
    const recent = await db.recent(user.id, LIMITS.windowSeconds);
    if (recent.total >= LIMITS.perHour) {
      memory.release(user.id, message.id);
      const minutes = recent.oldest ? Math.max(1, Math.ceil((recent.oldest.getTime() + LIMITS.windowSeconds * 1000 - Date.now()) / 60000)) : 60;
      return { ok: false, reason: 'limit', minutes, max: LIMITS.perHour };
    }
    row = await db.add({
      reporterId: user.id, reporterTag: user.tag ?? user.username ?? null, messageId: message.id, channelId: message.channelId ?? message.channel?.id,
      guildId: guild?.id ?? null, guildName: guild?.name ?? null, kind, category, details: text, messageText: snapshotOf(message), deletedDm: deleteAfter === true,
    });
  } catch (error) {
    memory.release(user.id, message.id);
    logger.error({ action: 'dm-report' }, `A DM report could not be stored: ${error.message}`);
    return { ok: false, reason: 'failed' };
  }
  if (!row) return { ok: false, reason: 'duplicate' };

  const deliveredId = await deliverToTeam(client, row, deps.channelId ? { channelId: deps.channelId } : undefined);
  if (deliveredId) await db.setDelivered(row.id, deliveredId).catch(() => {});

  let deleted = false;
  if (deleteAfter) deleted = await message.delete().then(() => true, () => false);
  return { ok: true, id: row.id, delivered: Boolean(deliveredId), deleted };
}

module.exports = { LIMITS, defang, messageText, snapshotOf, teamCard, deliverToTeam, createLimiter, submitDmReport };

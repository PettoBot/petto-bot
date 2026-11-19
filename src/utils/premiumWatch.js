"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newState = exports.WATCH_MS = void 0;
exports.isActiveNow = isActiveNow;
exports.targetOf = targetOf;
exports.signature = signature;
exports.classify = classify;
exports.applyBatch = applyBatch;
exports.seed = seed;
exports.changedSince = changedSince;
exports.recordText = recordText;
exports.recordCard = recordCard;
exports.sendRecord = sendRecord;
exports.watchOnce = watchOnce;
const { getPrimaryPool } = require('../db/postgres');
const logger = require('./logger');
const config = require('../config');
/** How often the entitlements are looked at, in milliseconds. */
exports.WATCH_MS = 15_000;
/** An entitlement is active when its status says so and its period has not ended. */
function isActiveNow(entitlement, now) {
    if (entitlement.status !== 'active')
        return false;
    if (!entitlement.current_period_end)
        return true;
    const end = Date.parse(entitlement.current_period_end);
    return Number.isFinite(end) && end > now;
}
/**
 * Who or what a Premium is for. A Premium granted by hand says it in its key (`manual:user:<id>` or `manual:server:<id>`): the dashboard used to keep the owner of Petto as the
 * holder of every grant (`user_id`), so the key is read first. A paid one is for its `user_id`.
 */
function targetOf(entitlement) {
    const match = /^manual:(user|server):(\d+)$/.exec(entitlement.provider_subscription_id ?? '');
    if (match)
        return { type: match[1], id: match[2] };
    if (entitlement.metadata?.target_type === 'server' && entitlement.metadata.target_guild_id)
        return { type: 'server', id: String(entitlement.metadata.target_guild_id) };
    return entitlement.user_id ? { type: 'user', id: entitlement.user_id } : { type: 'unknown', id: null };
}
/** What makes two states of an entitlement different for the record (the plan, the slots, the end date, the status). */
function signature(entitlement) {
    return [entitlement.status, entitlement.slot_limit, entitlement.plan_key, entitlement.current_period_end ? Date.parse(entitlement.current_period_end) : ''].join('|');
}
/** What happened to an entitlement between what was known and what it is now (pure). Null when nothing a person would care about changed. */
function classify(before, now, at) {
    const wasActive = before ? isActiveNow(before, at) : false;
    const isActive = isActiveNow(now, at);
    if (!before)
        return isActive ? 'granted' : null;
    if (!wasActive && isActive)
        return 'granted';
    if (wasActive && !isActive)
        return now.status === 'active' ? 'expired' : now.provider === 'manual' ? 'revoked' : 'ended';
    if (wasActive && isActive && signature(before) !== signature(now))
        return 'changed';
    return null;
}
const newState = () => ({ known: new Map(), cursor: null });
exports.newState = newState;
/** The changes of a batch of entitlements, updating what is known. The ones that are not in the batch are checked for an end date that passed. */
function applyBatch(state, rows, at) {
    const changes = [];
    for (const row of rows) {
        const kind = classify(state.known.get(row.id), row, at);
        state.known.set(row.id, row);
        if (kind)
            changes.push({ kind, entitlement: row });
        if (!state.cursor || row.updated_at > state.cursor)
            state.cursor = row.updated_at;
    }
    const touched = new Set(rows.map((row) => row.id));
    for (const [id, row] of state.known) {
        if (touched.has(id) || row.status !== 'active' || !row.current_period_end)
            continue;
        // An active entitlement whose end date passed without any change in the database: it ended by itself.
        if (!isActiveNow(row, at)) {
            state.known.set(id, { ...row, status: 'expired' });
            changes.push({ kind: 'expired', entitlement: row });
        }
    }
    return changes;
}
const COLUMNS = 'id,user_id,provider,provider_subscription_id,plan_key,status,slot_limit,current_period_end,metadata,updated_at';
const toEntitlement = (row) => ({
    id: Number(row.id),
    user_id: row.user_id == null ? null : String(row.user_id),
    provider: row.provider == null ? null : String(row.provider),
    provider_subscription_id: row.provider_subscription_id == null ? null : String(row.provider_subscription_id),
    plan_key: row.plan_key == null ? null : String(row.plan_key),
    status: row.status == null ? null : String(row.status),
    slot_limit: row.slot_limit == null ? null : Number(row.slot_limit),
    current_period_end: row.current_period_end == null ? null : new Date(row.current_period_end).toISOString(),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
    updated_at: new Date(row.updated_at).toISOString(),
});
/** Remembers how every entitlement is now, so the first look after a start does not report old changes (they were listed at start). */
async function seed(state, query = getPrimaryPool().query) {
    const { rows } = await query(`select ${COLUMNS} from premium_entitlements order by updated_at asc limit 5000`);
    for (const row of rows) {
        const entitlement = toEntitlement(row);
        state.known.set(entitlement.id, entitlement);
        if (!state.cursor || entitlement.updated_at > state.cursor)
            state.cursor = entitlement.updated_at;
    }
    state.cursor ??= new Date().toISOString();
}
/** The entitlements changed since the last look (the same instant is read again: what did not change is dropped by `classify`). */
async function changedSince(state, query = getPrimaryPool().query) {
    const { rows } = await query(`select ${COLUMNS} from premium_entitlements where updated_at >= $1 order by updated_at asc, id asc limit 200`, [state.cursor ?? new Date(0).toISOString()]);
    return rows.map(toEntitlement);
}
// ---- The record ----
const TITLES = {
    granted: 'Premium granted',
    changed: 'Premium changed',
    revoked: 'Premium revoked',
    ended: 'Premium ended',
    expired: 'Premium expired',
};
const COLORS = { granted: 0xa5ea7a, changed: 0xf0a88f, revoked: 0xfe6465, ended: 0xfe6465, expired: 0xfed53c };
const sourceOf = (entitlement) => {
    if (entitlement.provider === 'manual') {
        const by = entitlement.metadata?.granted_by;
        return `Manual${by ? ` · by <@${String(by)}>` : ''}`;
    }
    return entitlement.provider === 'polar' ? 'Polar' : entitlement.provider || 'Unknown';
};
/** The text of the record of a change (pure). `roleSynced` says what happened to the role: true given or taken, false the person is not in the Premium server, null not looked at. */
function recordText(change, gem, roleSynced) {
    const { kind, entitlement } = change;
    const lines = [`### ${gem} ${TITLES[kind]}`];
    const who = targetOf(entitlement);
    lines.push(who.type === 'server' ? `Server \`${who.id}\`` : who.id ? `<@${who.id}> · \`${who.id}\`` : 'Unknown');
    const active = kind === 'granted' || kind === 'changed';
    lines.push(`**Plan:** ${entitlement.plan_key ?? 'premium'} · **Slots:** ${entitlement.slot_limit ?? 1}`);
    if (active)
        lines.push(entitlement.current_period_end ? `**Until:** <t:${Math.floor(Date.parse(entitlement.current_period_end) / 1000)}:f>` : '**Until:** no end date');
    lines.push(`**Source:** ${sourceOf(entitlement)}`);
    if (roleSynced === true)
        lines.push(active ? '**Role:** given' : '**Role:** taken away');
    else if (roleSynced === false)
        lines.push('**Role:** not in the Premium server, it is given when they join');
    return lines.join('\n');
}
/** The card of a change: the text with the Premium gem, and the avatar of the person at the side when there is one. */
function recordCard(change, gem, roleSynced, avatarUrl) {
    const { ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } = require('discord.js');
    const text = new TextDisplayBuilder().setContent(recordText(change, gem, roleSynced));
    const card = new ContainerBuilder().setAccentColor(COLORS[change.kind]);
    if (avatarUrl)
        card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl)));
    else
        card.addTextDisplayComponents(text);
    return card;
}
/** The record in the channel. Nothing when the channel is not set; a failure is logged and never stops the role. */
async function sendRecord(client, change, roleSynced) {
    if (!config.premiumLogChannelId)
        return;
    const { MessageFlags } = require('discord.js');
    const { EMOJI } = require('./emojis');
    const channel = await client.channels.fetch(config.premiumLogChannelId).catch(() => null);
    if (!channel || !('send' in channel)) {
        logger.warn('Premium record: the channel could not be found.');
        return;
    }
    const who = targetOf(change.entitlement);
    const user = who.type === 'user' && who.id ? await client.users.fetch(who.id).catch(() => null) : null;
    const card = recordCard(change, EMOJI.GEM, roleSynced, user?.displayAvatarURL({ size: 128 }) ?? null);
    await channel.send({ components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}
/** One look: what changed gets its role now and its record. Returns the changes, for the logs and the tests. */
async function watchOnce(state, deps) {
    const query = deps.query ?? getPrimaryPool().query;
    const at = (deps.now ?? Date.now)();
    if (!state.cursor) {
        await seed(state, query);
        return [];
    }
    const changes = applyBatch(state, await changedSince(state, query), at);
    const syncRole = deps.syncRole ?? ((client, userId) => require('../jobs/premiumRoleJob').syncPremiumRoleForUser(client, userId));
    const send = deps.send ?? sendRecord;
    for (const change of changes) {
        let roleSynced = null;
        // The role is for the person the Premium is for; a Premium for a server gives no role.
        const who = targetOf(change.entitlement);
        const userId = who.type === 'user' ? who.id : null;
        if (userId)
            roleSynced = await syncRole(deps.client, userId).catch((error) => { logger.warn(`Premium watch: the role of ${userId} could not be updated: ${error.message}`); return null; });
        await send(deps.client, change, roleSynced).catch((error) => logger.warn(`Premium watch: the record could not be sent: ${error.message}`));
    }
    return changes;
}

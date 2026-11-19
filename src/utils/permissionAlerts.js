"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dismiss = exports.forgetSeen = exports.problemOfRow = exports.problemOfDiagnosis = void 0;
exports.describeProblem = describeProblem;
exports.explain = explain;
exports.featureLabel = featureLabel;
exports.guildOf = guildOf;
exports.reportPermissionProblem = reportPermissionProblem;
exports.listForDashboard = listForDashboard;
// i18n-ignore-file: the texts are in src/i18n/locales/<lang>/permdiag.js; nothing is written here for a person.
// When something Petto tried to do failed because of a permission (the error of Discord says "Missing Permissions"), this says exactly what is missing and where, and tells the staff:
//   - `explain(error, lang, guild)`: the sentence for the member who asked ("I am missing **Ban Members** in this server"), or null when it cannot be known (then the generic text is used).
//   - `reportPermissionProblem(error, { guild, feature })`: saves the problem (one row for the same feature, request and permission) and tells the staff in the log channel of the server once every
//     24 hours at most, however many times it happens. It never sends a DM to the owner and never an alert of the team: it is only for the staff of the server.
//   - `listForDashboard(guild, lang)` / `dismiss(guild, key)`: what the dashboard shows. Each time it is asked, every problem is checked again against what Petto has now, so what the staff fixed goes away by itself.
// A feature that swallows its own errors (`.catch(() => null)`) never reaches this: only what is thrown, or what a command already tells the member, is covered.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/permissionAlerts.js, which is what the bot loads.
const permissionDiagnosis_1 = require("./permissionDiagnosis");
const { t, currentLanguage, peekGuildLanguage } = require('../i18n');
const { permissionName } = require('./permissionLabels');
const problemOfDiagnosis = (d) => ({
    kind: d.kind === 'hierarchy' ? 'hierarchy' : 'missing',
    needs: d.missing.map((item) => ({ flag: item.flag, scope: item.scope, channelId: item.channelId })),
    role: d.role,
    memberAbove: Boolean(d.member),
});
exports.problemOfDiagnosis = problemOfDiagnosis;
const problemOfRow = (row) => ({
    kind: row.kind,
    needs: (row.needs ?? []).map((item) => ({ flag: item.flag, scope: item.scope, channelId: item.channelId })),
    role: row.role_id ? { id: row.role_id, name: row.role_name ?? '', managed: Boolean(row.role_managed) } : null,
    memberAbove: Boolean(row.member_id),
});
exports.problemOfRow = problemOfRow;
/** The lines that say what is missing and where. `mention`: the channel as a mention (in Discord) or as `#name` (in the dashboard). */
function describeProblem(problem, lang, guild, { mention = true } = {}) {
    const lines = [];
    const items = problem.needs.map((need) => {
        let where = t(lang, 'permdiag.here.server');
        if (need.scope === 'channel' && need.channelId) {
            const name = guild?.channels?.cache?.get(need.channelId)?.name;
            where = t(lang, 'permdiag.here.channel', { channel: mention || !name ? `<#${need.channelId}>` : `#${name}` });
        }
        return { permission: permissionName(need.flag, lang), where };
    });
    if (items.length === 1)
        lines.push(t(lang, 'permdiag.member.single', items[0]));
    else if (items.length > 1)
        lines.push(t(lang, 'permdiag.member.many', { list: items.slice(0, 5).map((item) => t(lang, 'permdiag.item', item)).join(', ') }));
    if (problem.role)
        lines.push(t(lang, problem.role.managed ? 'permdiag.role.managed' : 'permdiag.role.above', { role: `**${problem.role.name || problem.role.id}**` }));
    if (problem.memberAbove)
        lines.push(t(lang, 'permdiag.member.above'));
    return lines;
}
/** The sentence for the member who asked, or null when what is missing cannot be known (the generic text is used then). */
function explain(error, lang = currentLanguage(), guild = null) {
    const diagnosis = (0, permissionDiagnosis_1.diagnoseError)(guild, error);
    if (diagnosis.kind === 'unknown')
        return null;
    const lines = describeProblem((0, exports.problemOfDiagnosis)(diagnosis), lang, guild);
    return lines.length ? lines.join('\n').slice(0, 1900) : null;
}
/** "the command **ban**", "the **guildMemberAdd** event"... from `command:ban`, `event:guildMemberAdd`, `ticket` or anything else. */
function featureLabel(feature, lang) {
    const [kind, ...rest] = String(feature ?? '').split(':');
    const name = rest.join(':');
    if (kind === 'command' && name)
        return t(lang, 'permdiag.feature.command', { name });
    if (kind === 'event' && name)
        return t(lang, 'permdiag.feature.event', { name });
    if (kind === 'ticket')
        return t(lang, 'permdiag.feature.ticket');
    return t(lang, 'permdiag.feature.task');
}
// The same problem is written to the database once a minute at the most (the times it happened in between are added up), and the memory of that is bounded.
const WRITE_EVERY_MS = 60_000;
const MAX_REMEMBERED = 2_000;
const seen = new Map();
/** For the checks: forget what was written. */
const forgetSeen = () => seen.clear();
exports.forgetSeen = forgetSeen;
/** The server an error is about, from the address of its request (`/guilds/:id/...` or `/channels/:id/...`), or null. */
function guildOf(client, error) {
    const guildId = (0, permissionDiagnosis_1.guildIdOf)(error);
    if (guildId)
        return client?.guilds?.cache?.get(guildId) ?? null;
    const channelId = (0, permissionDiagnosis_1.channelIdOf)(error);
    return channelId ? client?.channels?.cache?.get(channelId)?.guild ?? null : null;
}
const store = () => require('../db/permissionAlerts');
/**
 * Saves the problem and, when the staff has not been told in the last 24 hours, tells them in the log channel of the server. Returns the diagnosis (or null when nothing could be said).
 * It never throws: a failure here must not make the original error worse.
 */
async function reportPermissionProblem(error, { guild, feature }) {
    try {
        const diagnosis = (0, permissionDiagnosis_1.diagnoseError)(guild, error);
        if (diagnosis.kind === 'unknown' || !guild?.id)
            return null;
        const key = (0, permissionDiagnosis_1.problemKey)(feature, diagnosis);
        const memory = `${guild.id}:${key}`;
        const before = seen.get(memory);
        const now = Date.now();
        if (before && now - before.at < WRITE_EVERY_MS) {
            before.pending += 1;
            return diagnosis;
        }
        if (seen.size >= MAX_REMEMBERED)
            seen.clear();
        seen.set(memory, { at: now, pending: 0 });
        const problem = (0, exports.problemOfDiagnosis)(diagnosis);
        const row = await store().record({
            guildId: guild.id, key, feature, kind: problem.kind, needs: problem.needs, channelId: diagnosis.channelId,
            roleId: problem.role?.id ?? null, roleName: problem.role?.name ?? null, roleManaged: problem.role?.managed ?? false,
            memberId: diagnosis.member?.id ?? null, count: 1 + (before?.pending ?? 0),
        });
        const claimed = await store().claimNotice(guild.id, key);
        if (!claimed)
            return diagnosis;
        const lang = peekGuildLanguage(guild.id);
        const details = [t(lang, 'permdiag.notice.feature', { feature: featureLabel(feature, lang), count: Number(row.occurrences) || 1 }), ...describeProblem(problem, lang, guild)].join('\n');
        const { sendGuildNotice } = require('./guildOpsAlerts');
        await sendGuildNotice(guild.client, { guildId: guild.id, kind: 'permissionAlert', details, force: true, staffOnly: true, source: 'Permission diagnosis' }); // i18n-ignore: internal source label
        return diagnosis;
    }
    catch (failure) {
        try {
            require('./logger').warn('Could not save a permission problem:', failure?.message);
        }
        catch { /* nothing else to do */ }
        return null;
    }
}
const iso = (value) => (value ? new Date(value).toISOString() : null);
const plain = (text) => text.replace(/\*\*/g, '');
/** The problems of a server for the dashboard, each one checked again: what is fixed is removed from the list (and from the database). */
async function listForDashboard(guild, lang) {
    const rows = await store().list(guild.id);
    const out = [];
    for (const row of rows) {
        const problem = (0, exports.problemOfRow)(row);
        if (!(0, permissionDiagnosis_1.stillBroken)(guild, { needs: problem.needs, roleId: problem.role?.id ?? null })) {
            await store().remove(guild.id, row.problem_key);
            continue;
        }
        out.push({
            key: row.problem_key, feature: plain(featureLabel(row.feature, lang)), kind: row.kind,
            lines: describeProblem(problem, lang, guild, { mention: false }).map(plain), occurrences: Number(row.occurrences) || 1,
            firstSeen: iso(row.first_seen), lastSeen: iso(row.last_seen), notifiedAt: iso(row.last_notified),
        });
    }
    return out;
}
/** "Dismiss" in the dashboard: the problem is taken off the list (it comes back by itself if it happens again). */
const dismiss = (guild, key) => store().remove(guild.id, String(key));
exports.dismiss = dismiss;

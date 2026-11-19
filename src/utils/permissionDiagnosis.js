"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathOf = pathOf;
exports.planOf = planOf;
exports.guildIdOf = guildIdOf;
exports.channelIdOf = channelIdOf;
exports.diagnoseError = diagnoseError;
exports.stillBroken = stillBroken;
exports.problemKey = problemKey;
// What exactly is missing when Discord says "Missing Permissions". The error of Discord carries the request that failed (its method, its address and its
// body), and each request needs known permissions: sending a message needs View Channel and Send Messages in that channel, giving a role needs Manage Roles
// and a role under Petto's, kicking needs Kick Members, and so on. So the error is read, the permissions the bot really has are looked at, and what is missing
// is said in plain words: which permission, and where (in the server or in which channel), or which role or member is above Petto's.
// It never guesses: when the request is not one of the known ones, or nothing is missing, the answer is `unknown` and the generic text is used.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/permissionDiagnosis.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
const UNKNOWN = { kind: 'unknown', missing: [], role: null, member: null, channelId: null, route: '' };
const channelNeed = (flag, channelId) => ({ flag, scope: 'channel', channelId });
const serverNeed = (flag) => ({ flag, scope: 'server', channelId: null });
/** The address of a request without the host, the version and the query: `/channels/123/messages`. */
function pathOf(url) {
    const text = String(url ?? '');
    const path = text.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
    return path.replace(/^\/api(?:\/v\d+)?/i, '');
}
/** What a request needs, by its method and its address (and by its body when the same address does different things). */
function planOf(method, path, body, isThread = () => false) {
    const m = String(method ?? '').toUpperCase();
    const has = (key) => Boolean(body && body[key] !== undefined && body[key] !== null);
    let hit;
    if ((hit = /^\/channels\/(\d+)\/messages$/.exec(path)) && m === 'POST') {
        const id = hit[1];
        const needs = [channelNeed('ViewChannel', id), channelNeed(isThread(id) ? 'SendMessagesInThreads' : 'SendMessages', id)];
        if (Array.isArray(body?.embeds) && body.embeds.length)
            needs.push(channelNeed('EmbedLinks', id));
        if (Array.isArray(body?.attachments) && body.attachments.length)
            needs.push(channelNeed('AttachFiles', id));
        if (has('message_reference'))
            needs.push(channelNeed('ReadMessageHistory', id));
        return { needs, channelId: id };
    }
    if ((hit = /^\/channels\/(\d+)\/messages\/bulk-delete$/.exec(path)) && m === 'POST')
        return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ManageMessages', hit[1])], channelId: hit[1] };
    if ((hit = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(path))) {
        if (m === 'DELETE')
            return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ManageMessages', hit[1])], channelId: hit[1] };
        if (m === 'PATCH')
            return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ReadMessageHistory', hit[1])], channelId: hit[1] };
    }
    if ((hit = /^\/channels\/(\d+)\/messages\/(\d+)\/reactions\/.+/.exec(path))) {
        if (m === 'PUT')
            return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ReadMessageHistory', hit[1]), channelNeed('AddReactions', hit[1])], channelId: hit[1] };
        if (m === 'DELETE')
            return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ManageMessages', hit[1])], channelId: hit[1] };
    }
    if ((hit = /^\/channels\/(\d+)\/(?:messages\/\d+\/)?threads$/.exec(path)) && m === 'POST') {
        const flag = Number(body?.type) === 12 ? 'CreatePrivateThreads' : 'CreatePublicThreads';
        return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed(flag, hit[1]), channelNeed('SendMessagesInThreads', hit[1])], channelId: hit[1] };
    }
    if ((hit = /^\/channels\/(\d+)\/webhooks$/.exec(path)))
        return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ManageWebhooks', hit[1])], channelId: hit[1] };
    if ((hit = /^\/channels\/(\d+)\/invites$/.exec(path)) && m === 'POST')
        return { needs: [channelNeed('CreateInstantInvite', hit[1])], channelId: hit[1] };
    if ((hit = /^\/channels\/(\d+)\/permissions\/(\d+)$/.exec(path)))
        return { needs: [channelNeed('ViewChannel', hit[1]), channelNeed('ManageChannels', hit[1]), channelNeed('ManageRoles', hit[1])], channelId: hit[1] };
    if ((hit = /^\/channels\/(\d+)$/.exec(path)) && (m === 'PATCH' || m === 'DELETE')) {
        const needs = [channelNeed('ViewChannel', hit[1]), channelNeed('ManageChannels', hit[1])];
        if (m === 'PATCH' && has('permission_overwrites'))
            needs.push(channelNeed('ManageRoles', hit[1]));
        return { needs, channelId: hit[1] };
    }
    if (/^\/guilds\/\d+\/channels$/.test(path) && m === 'POST') {
        const needs = [serverNeed('ManageChannels')];
        if (has('permission_overwrites'))
            needs.push(serverNeed('ManageRoles'));
        return { needs };
    }
    if ((hit = /^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/.exec(path)) && (m === 'PUT' || m === 'DELETE'))
        return { needs: [serverNeed('ManageRoles')], roleId: hit[2] };
    if ((hit = /^\/guilds\/\d+\/members\/(\d+)$/.exec(path))) {
        if (m === 'DELETE')
            return { needs: [serverNeed('KickMembers')], memberId: hit[1] };
        if (m === 'PATCH') {
            const needs = [];
            if (has('communication_disabled_until'))
                needs.push(serverNeed('ModerateMembers'));
            if (has('nick'))
                needs.push(serverNeed('ManageNicknames'));
            if (has('roles'))
                needs.push(serverNeed('ManageRoles'));
            if (has('channel_id'))
                needs.push(serverNeed('MoveMembers'));
            if (has('mute'))
                needs.push(serverNeed('MuteMembers'));
            if (has('deaf'))
                needs.push(serverNeed('DeafenMembers'));
            return needs.length ? { needs, memberId: hit[1] } : null;
        }
    }
    if ((hit = /^\/guilds\/\d+\/bans\/(\d+)$/.exec(path)) && (m === 'PUT' || m === 'DELETE'))
        return { needs: [serverNeed('BanMembers')], memberId: m === 'PUT' ? hit[1] : undefined };
    if ((hit = /^\/guilds\/\d+\/roles(?:\/(\d+))?$/.exec(path)))
        return { needs: [serverNeed('ManageRoles')], roleId: hit[1] && m !== 'GET' ? hit[1] : undefined };
    if (/^\/guilds\/\d+\/(?:emojis|stickers)(?:\/\d+)?$/.test(path) && m !== 'GET')
        return { needs: [serverNeed('ManageGuildExpressions')] };
    if (/^\/guilds\/\d+\/auto-moderation\/rules(?:\/\d+)?$/.test(path))
        return { needs: [serverNeed('ManageGuild')] };
    if (/^\/guilds\/\d+\/audit-logs$/.test(path))
        return { needs: [serverNeed('ViewAuditLog')] };
    if (/^\/guilds\/\d+\/invites$/.test(path))
        return { needs: [serverNeed('ManageGuild')] };
    if (/^\/guilds\/\d+\/scheduled-events/.test(path) && m !== 'GET')
        return { needs: [serverNeed('ManageEvents')] };
    return null;
}
/** What Discord says about the request that failed. */
function requestOf(error) {
    if (!error || typeof error !== 'object' || !error.url)
        return null;
    const body = error.requestBody && typeof error.requestBody === 'object' ? (error.requestBody.json ?? undefined) : undefined;
    return { method: String(error.method ?? ''), path: pathOf(error.url), body: body && typeof body === 'object' ? body : undefined };
}
const hasFlag = (permissions, flag) => Boolean(permissions?.has?.(discord_js_1.PermissionFlagsBits[flag]));
/** The id of the server of a request, when its address has it (`/guilds/123/...`). */
function guildIdOf(error) {
    const request = requestOf(error);
    return request ? /^\/guilds\/(\d+)/.exec(request.path)?.[1] ?? null : null;
}
/** The id of the channel of a request, when its address has it (`/channels/123/...`). */
function channelIdOf(error) {
    const request = requestOf(error);
    return request ? /^\/channels\/(\d+)/.exec(request.path)?.[1] ?? null : null;
}
/**
 * Reads the error of Discord and looks at what Petto really has in `guild` (its member `me`, its roles and the channel of the request). Returns what is missing,
 * or `unknown` when the request is not a known one, the channel is gone, or nothing is missing (then the cause is another: ask the staff to look at the roles).
 */
function diagnoseError(guild, error) {
    const request = requestOf(error);
    const me = guild?.members?.me;
    if (!request || !guild || !me)
        return UNKNOWN;
    const isThread = (id) => Boolean(guild.channels?.cache?.get(id)?.isThread?.());
    const plan = planOf(request.method, request.path, request.body, isThread);
    if (!plan)
        return UNKNOWN;
    const missing = [];
    for (const need of plan.needs) {
        if (need.scope === 'channel') {
            const channel = guild.channels?.cache?.get(need.channelId);
            if (!channel)
                return UNKNOWN; // a channel that is gone: nothing to say about permissions
            // A thread takes what its parent channel gives; discord.js answers it too.
            if (!hasFlag(channel.permissionsFor?.(me), need.flag))
                missing.push({ flag: need.flag, scope: 'channel', channelId: need.channelId });
        }
        else if (!hasFlag(me.permissions, need.flag)) {
            missing.push({ flag: need.flag, scope: 'server', channelId: null });
        }
    }
    const route = `${request.method.toUpperCase()} ${request.path.replace(/\d{15,25}/g, ':id')}`;
    const top = me.roles?.highest?.position ?? 0;
    let role = null;
    if (plan.roleId) {
        const found = guild.roles?.cache?.get(plan.roleId);
        if (found && (found.managed || found.position >= top) && found.id !== guild.id)
            role = { id: found.id, name: String(found.name ?? ''), managed: Boolean(found.managed) };
    }
    let member = null;
    if (plan.memberId) {
        const target = guild.members?.cache?.get(plan.memberId);
        if (target && (target.id === guild.ownerId || (target.roles?.highest?.position ?? 0) >= top) && target.id !== me.id)
            member = { id: target.id };
    }
    if (!missing.length && !role && !member)
        return UNKNOWN;
    return { kind: missing.length ? 'missing' : 'hierarchy', missing, role, member, channelId: plan.channelId ?? null, route };
}
/** Whether what a stored problem said is still true now (so the dashboard stops showing what the staff already fixed). */
function stillBroken(guild, problem) {
    const me = guild?.members?.me;
    if (!guild || !me)
        return true; // it cannot be checked: it is left as it is
    for (const need of problem.needs ?? []) {
        if (need.scope === 'channel') {
            const channel = guild.channels?.cache?.get(need.channelId);
            if (!channel)
                continue; // the channel is gone: that problem is gone with it
            if (!hasFlag(channel.permissionsFor?.(me), need.flag))
                return true;
        }
        else if (!hasFlag(me.permissions, need.flag))
            return true;
    }
    if (problem.roleId) {
        const role = guild.roles?.cache?.get(problem.roleId);
        if (role && role.id !== guild.id && (role.managed || role.position >= (me.roles?.highest?.position ?? 0)))
            return true;
    }
    return false;
}
/** The key that tells two problems apart: the same feature, the same request and the same thing missing is one problem, however many times it happens. */
function problemKey(feature, diagnosis) {
    const parts = diagnosis.missing.map((item) => `${item.flag}@${item.channelId ?? 'server'}`).sort();
    return [feature, diagnosis.route, parts.join(','), diagnosis.role?.id ?? '', diagnosis.member ? 'member' : ''].join('|');
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REASON = exports.MAX_TIMEOUT_SECONDS = exports.MIN_SCHEDULE_SECONDS = exports.MAX_SCHEDULE_SECONDS = exports.ROLE_EDIT_KEYS = exports.CHANNEL_EDIT_KEYS = exports.LIST_KINDS = exports.CREATE_KINDS = void 0;
exports.permissionName = permissionName;
exports.register = register;
// i18n-ignore-file: function names, the keys of the maps and the options of the functions stay as they are in every language; the mistakes are phrases.
// The functions of Petto Code that reach beyond the message: read more of the server (messages, permissions, bans, the lists of roles and
// channels), change it (messages, channels, threads, roles, nicknames, moderation), ask a web page (httpGet and httpPost) and run a command
// later (scheduleUniqueCC). The ones that change something do not do it: they note an effect, and the bot decides in src/utils/codeActions
// whether to do it, as the member who used the command, never as more than that member could.
const discord_js_1 = require("discord.js");
/** The kinds of channel that createChannel makes, and the ones listChannels can filter by. */
exports.CREATE_KINDS = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 };
exports.LIST_KINDS = ['text', 'voice', 'category', 'announcement', 'thread', 'stage', 'forum', 'media'];
exports.CHANNEL_EDIT_KEYS = ['name', 'topic', 'slowmode', 'nsfw', 'parent'];
exports.ROLE_EDIT_KEYS = ['name', 'color', 'hoist', 'mentionable'];
exports.MAX_SCHEDULE_SECONDS = 7 * 86_400;
exports.MIN_SCHEDULE_SECONDS = 5;
exports.MAX_TIMEOUT_SECONDS = 28 * 86_400;
exports.MAX_REASON = 400;
const PERMISSION_NAMES = new Map(Object.keys(discord_js_1.PermissionFlagsBits).map((name) => [name.toLowerCase(), name]));
/** The name of a permission as discord.js spells it (`ManageMessages`), from how a person may write it ("manage messages", "manage_messages"), or null. */
function permissionName(value) {
    return PERMISSION_NAMES.get(value.replace(/[\s_-]+/g, '').toLowerCase()) ?? null;
}
const ID = /^(?:<[@#]&?!?)?(\d{15,22})>?$/;
function register(h) {
    const { def, fail, what, expected, text, num, str, snowflake, isTruthy, FORBIDDEN_KEYS } = h;
    // ── Reading the arguments ────────────────────────────────────────────────
    const idOf = (value, wanted) => {
        const match = ID.exec(text(value).trim());
        return match ? match[1] : fail('expectedId', { what: wanted });
    };
    const userArg = (value) => idOf(value, what('theUser'));
    const channelArg = (value) => idOf(value, what('aChannel'));
    const roleArg = (value) => idOf(value, what('aRole'));
    const messageArg = (value) => snowflake(value, what('anId'));
    /** A channel, or nil for the one of the command. */
    const channelOrHere = (env, value) => {
        if (value === null || value === undefined || value === '' || value === 0) {
            const here = env.data?.Channel?.ID;
            if (!here)
                fail('expectedId', { what: what('aChannel') });
            return here;
        }
        return channelArg(value);
    };
    const whole = (value, name, min, max) => {
        const number = Math.trunc(num(value));
        if (number < min || number > max)
            fail('range', { name, min, max });
        return number;
    };
    const textOf = (value, partName, max, { empty = false } = {}) => {
        const result = text(value).trim();
        if (!empty && !result)
            fail('emptyText', { name: partName });
        if ([...result].length > max)
            fail('longerThan', { what: partName, max });
        return result;
    };
    const reasonOf = (value) => (value === undefined || value === null || value === '' ? null : textOf(value, 'reason', exports.MAX_REASON));
    const colorOf = (value) => {
        if (typeof value === 'string' && !/^#?[0-9a-f]{6}$/i.test(value) && !/^\d+$/.test(value.trim()))
            fail('color');
        const color = typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value) ? parseInt(value.replace('#', ''), 16) : Math.trunc(num(value));
        if (color < 0 || color > 0xffffff)
            fail('color');
        return color;
    };
    const flag = (value) => isTruthy(value);
    const plainMap = (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            expected(what('aMap'), value);
        return value;
    };
    const cleanJson = (item, depth = 0) => {
        if (depth > 6)
            return null;
        if (Array.isArray(item))
            return item.slice(0, 200).map((entry) => cleanJson(entry, depth + 1));
        if (item && typeof item === 'object') {
            const out = {};
            for (const key of Object.keys(item).slice(0, 200))
                if (!FORBIDDEN_KEYS.has(key))
                    out[key] = cleanJson(item[key], depth + 1);
            return out;
        }
        return item;
    };
    // ── Reading more of the server ───────────────────────────────────────────
    // A message of a channel (text, author, date, files, reactions), or nil when it is not there or the member cannot see that channel.
    def('getMessage', 2, 2, async (env, channel, id) => h.needLookup(env).call('message', channelOrHere(env, channel), messageArg(id)));
    // The latest messages of a channel, the newest first: 1 to 10 (5 when it is not said).
    def('getMessages', 0, 2, async (env, channel, count) => h.needLookup(env).call('messages', channelOrHere(env, channel), count === undefined ? 5 : whole(count, 'getMessages', 1, 10)));
    // A user: of this server (with their member data) or not.
    def('userInfo', 1, 1, async (env, user) => h.needLookup(env).call('user', userArg(user)));
    // The data of the server, read again now (`.Guild` is the one of the moment the command started).
    def('guildInfo', 0, 0, async (env) => h.needLookup(env).call('guild'));
    // Whether a member has a permission in the server, or in a channel when it is given: `hasPermission .User.ID "ManageMessages"`.
    def('hasPermission', 2, 3, async (env, user, name, channel) => {
        const wanted = permissionName(str(name, what('aText')));
        if (!wanted)
            fail('permissionName', { value: text(name).slice(0, 40) });
        return h.needLookup(env).call('permission', userArg(user), wanted, channel === undefined || channel === null ? null : channelArg(channel));
    });
    // Whether a user is banned here (nil when Petto cannot look at the bans).
    def('isBanned', 1, 1, async (env, user) => h.needLookup(env).call('banned', userArg(user)));
    def('listRoles', 0, 0, async (env) => h.needLookup(env).call('roles'));
    def('listChannels', 0, 1, async (env, kind) => {
        let wanted = null;
        if (kind !== undefined && kind !== null && kind !== '') {
            wanted = str(kind, what('aText')).toLowerCase();
            if (!exports.LIST_KINDS.includes(wanted))
                fail('oneOf', { name: 'listChannels', value: wanted.slice(0, 20), options: exports.LIST_KINDS.join(', ') });
        }
        return h.needLookup(env).call('channels', wanted);
    });
    // ── Asking a web page ────────────────────────────────────────────────────
    const headersOf = (value) => {
        if (value === undefined || value === null)
            return {};
        const map = plainMap(value);
        const entries = Object.entries(map);
        const out = {};
        if (entries.length > 10)
            fail('badHeaders');
        for (const [name, header] of entries) {
            if (typeof header !== 'string' && typeof header !== 'number')
                fail('badHeaders');
            out[name] = text(header);
        }
        return out;
    };
    const webAnswer = (answer) => {
        const result = answer;
        return { ...result, JSON: cleanJson(result.JSON) };
    };
    def('httpGet', 1, 2, async (env, url, headers) => webAnswer(await h.needLookup(env).call('http', { method: 'GET', url: str(url, what('urlLink')), headers: headersOf(headers) })));
    // The body is a text, or a map that goes as JSON.
    def('httpPost', 2, 3, async (env, url, body, headers) => {
        const sent = headersOf(headers);
        let payload;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            payload = JSON.stringify(body);
            if (!Object.keys(sent).some((name) => name.toLowerCase() === 'content-type'))
                sent['Content-Type'] = 'application/json';
        }
        else
            payload = text(body);
        if (payload.length > 5000)
            fail('bodyTooLong', { max: 5000 });
        return webAnswer(await h.needLookup(env).call('http', { method: 'POST', url: str(url, what('urlLink')), headers: sent, body: payload }));
    });
    // ── Messages ─────────────────────────────────────────────────────────────
    // Changes a message that Petto sent. The member needs Manage Messages in that channel.
    def('editMessage', 3, 3, (env, channel, id, value) => {
        const message = h.messageOf(value);
        if (message.reactions)
            fail('reactionsOnlySend');
        if (!h.hasBody(message))
            fail('messageEmpty');
        env.effects.add('editMessage', { channelId: channelOrHere(env, channel), messageId: messageArg(id), ...message });
        return null;
    });
    def('deleteMessage', 2, 3, (env, channel, id, delay) => {
        env.effects.add('deleteMessage', { channelId: channelOrHere(env, channel), messageId: messageArg(id), delay: delay === undefined || delay === null ? 0 : whole(delay, 'deleteMessage', 0, 300) });
        return null;
    });
    def('pinMessage', 2, 2, (env, channel, id) => { env.effects.add('pinMessage', { channelId: channelOrHere(env, channel), messageId: messageArg(id) }); return null; });
    def('unpinMessage', 2, 2, (env, channel, id) => { env.effects.add('unpinMessage', { channelId: channelOrHere(env, channel), messageId: messageArg(id) }); return null; });
    // Deletes the latest 1 to 100 messages of a channel (the ones younger than two weeks).
    def('purgeMessages', 1, 2, (env, first, second) => {
        const withChannel = second !== undefined;
        env.effects.add('purgeMessages', { channelId: withChannel ? channelArg(first) : channelOrHere(env, null), count: whole(withChannel ? second : first, 'purgeMessages', 1, 100) });
        return null;
    });
    def('reactToMessage', 3, 3, (env, channel, id, emoji) => {
        const value = str(emoji, what('anEmoji'));
        if (!value || value.length > 100)
            fail('emojiLength');
        env.effects.add('reactToMessage', { channelId: channelOrHere(env, channel), messageId: messageArg(id), emoji: value });
        return null;
    });
    // ── Channels and threads ─────────────────────────────────────────────────
    def('createChannel', 2, 3, (env, name, kind, parent) => {
        const wanted = str(kind, what('aText')).toLowerCase();
        if (!(wanted in exports.CREATE_KINDS))
            fail('oneOf', { name: 'createChannel', value: wanted.slice(0, 20), options: Object.keys(exports.CREATE_KINDS).join(', ') });
        env.effects.add('createChannel', { name: textOf(name, 'name', 100), kind: wanted, parentId: parent === undefined || parent === null ? null : channelArg(parent) });
        return null;
    });
    // The changes are a map with some of name, topic, slowmode (seconds, 0 to 21600), nsfw and parent (a category, or nil to take it out).
    def('editChannel', 2, 2, (env, channel, changes) => {
        const map = plainMap(changes);
        const out = {};
        for (const key of Object.keys(map)) {
            if (!exports.CHANNEL_EDIT_KEYS.includes(key))
                fail('unknownKey', { name: 'editChannel', key, known: exports.CHANNEL_EDIT_KEYS.join(', ') });
            const value = map[key];
            if (key === 'name')
                out.name = textOf(value, 'name', 100);
            else if (key === 'topic')
                out.topic = textOf(value, 'topic', 1024, { empty: true });
            else if (key === 'slowmode')
                out.slowmode = whole(value, 'slowmode', 0, 21_600);
            else if (key === 'nsfw')
                out.nsfw = flag(value);
            else
                out.parentId = value === null || value === undefined || value === '' ? null : channelArg(value);
        }
        if (!Object.keys(out).length)
            fail('nothingToChange', { name: 'editChannel' });
        env.effects.add('editChannel', { channelId: channelArg(channel), changes: out });
        return null;
    });
    def('deleteChannel', 1, 1, (env, channel) => { env.effects.add('deleteChannel', { channelId: channelArg(channel) }); return null; });
    // `setSlowmode 5` is for the channel of the command, `setSlowmode channel 5` for another one.
    def('setSlowmode', 1, 2, (env, first, second) => {
        const withChannel = second !== undefined;
        env.effects.add('editChannel', { channelId: withChannel ? channelArg(first) : channelOrHere(env, null), changes: { slowmode: whole(withChannel ? second : first, 'setSlowmode', 0, 21_600) } });
        return null;
    });
    // Nobody can write in the channel (everyone) / the lock is taken off.
    def('lockChannel', 0, 2, (env, channel, reason) => { env.effects.add('lockChannel', { channelId: channelOrHere(env, channel), reason: reasonOf(reason) }); return null; });
    def('unlockChannel', 0, 2, (env, channel, reason) => { env.effects.add('unlockChannel', { channelId: channelOrHere(env, channel), reason: reasonOf(reason) }); return null; });
    // A thread in a channel; with the ID of a message, the thread of that message.
    def('createThread', 2, 3, (env, channel, name, message) => {
        env.effects.add('createThread', { channelId: channelOrHere(env, channel), name: textOf(name, 'name', 100), messageId: message === undefined || message === null ? null : messageArg(message) });
        return null;
    });
    def('lockThread', 1, 1, (env, thread) => { env.effects.add('lockThread', { channelId: channelArg(thread) }); return null; });
    def('archiveThread', 1, 1, (env, thread) => { env.effects.add('archiveThread', { channelId: channelArg(thread) }); return null; });
    // ── Moderation: as the member who used the command, with the same checks and the same cases as the commands of Petto ──
    def('ban', 1, 3, (env, user, days, reason) => {
        env.effects.add('ban', { userId: userArg(user), days: days === undefined || days === null ? 0 : whole(days, 'ban', 0, 7), reason: reasonOf(reason) });
        return null;
    });
    def('tempban', 2, 3, (env, user, duration, reason) => {
        env.effects.add('tempban', { userId: userArg(user), seconds: whole(duration, 'tempban', 60, 315_360_000), reason: reasonOf(reason) });
        return null;
    });
    def('unban', 1, 2, (env, user, reason) => { env.effects.add('unban', { userId: userArg(user), reason: reasonOf(reason) }); return null; });
    def('kick', 1, 2, (env, user, reason) => { env.effects.add('kick', { userId: userArg(user), reason: reasonOf(reason) }); return null; });
    // The time is in seconds (`toDuration "1h"` makes them), up to 28 days.
    def('mute', 2, 3, (env, user, duration, reason) => {
        env.effects.add('mute', { userId: userArg(user), seconds: whole(duration, 'mute', 1, exports.MAX_TIMEOUT_SECONDS), reason: reasonOf(reason) });
        return null;
    });
    def('unmute', 1, 2, (env, user, reason) => { env.effects.add('unmute', { userId: userArg(user), reason: reasonOf(reason) }); return null; });
    def('warn', 2, 2, (env, user, reason) => { env.effects.add('warn', { userId: userArg(user), reason: textOf(reason, 'reason', exports.MAX_REASON) }); return null; });
    // ── Roles, nicknames ─────────────────────────────────────────────────────
    def('createRole', 1, 2, (env, name, color) => { env.effects.add('createRole', { name: textOf(name, 'name', 100), color: color === undefined || color === null ? null : colorOf(color) }); return null; });
    // The changes are a map with some of name, color, hoist (shown apart) and mentionable.
    def('editRole', 2, 2, (env, role, changes) => {
        const map = plainMap(changes);
        const out = {};
        for (const key of Object.keys(map)) {
            if (!exports.ROLE_EDIT_KEYS.includes(key))
                fail('unknownKey', { name: 'editRole', key, known: exports.ROLE_EDIT_KEYS.join(', ') });
            const value = map[key];
            if (key === 'name')
                out.name = textOf(value, 'name', 100);
            else if (key === 'color')
                out.color = colorOf(value);
            else
                out[key] = flag(value);
        }
        if (!Object.keys(out).length)
            fail('nothingToChange', { name: 'editRole' });
        env.effects.add('editRole', { roleId: roleArg(role), changes: out });
        return null;
    });
    def('deleteRole', 1, 1, (env, role) => { env.effects.add('deleteRole', { roleId: roleArg(role) }); return null; });
    // Gives or takes a role of another member (`addRole` and `removeRole` are for the member who used the command).
    def('addRoleTo', 2, 2, (env, user, role) => { env.effects.add('addRoleTo', { userId: userArg(user), roleId: roleArg(role) }); return null; });
    def('removeRoleFrom', 2, 2, (env, user, role) => { env.effects.add('removeRoleFrom', { userId: userArg(user), roleId: roleArg(role) }); return null; });
    // A nickname of 1 to 32 characters; nil or "" takes it off.
    def('setNickname', 2, 2, (env, user, nick) => {
        env.effects.add('setNickname', { userId: userArg(user), nick: nick === null || nick === undefined || text(nick).trim() === '' ? null : textOf(nick, 'nickname', 32) });
        return null;
    });
    // ── Later ────────────────────────────────────────────────────────────────
    // Runs the command `name` after some seconds (5 to 7 days), as the same member, even if the bot restarts. The id makes it unique: scheduling again with
    // the same id (of the same command) replaces the first one. The data goes as JSON, like execCC.
    const scheduleName = (value) => {
        const wanted = str(value, what('theNameOfCommand')).trim().toLowerCase().replace(/^[^a-z0-9_-]+/, '');
        if (!/^[a-z0-9_-]{1,32}$/.test(wanted))
            fail('commandName');
        return wanted;
    };
    const scheduleId = (value) => {
        const wanted = text(value).trim();
        if (!/^[A-Za-z0-9_-]{1,50}$/.test(wanted))
            fail('scheduleId');
        return wanted;
    };
    def('scheduleUniqueCC', 3, 4, (env, name, id, delay, value) => {
        const json = JSON.stringify(value ?? null) ?? 'null';
        if (json.length > 2000)
            fail('execDataTooBig', { max: 2000 });
        const seconds = Math.trunc(num(delay));
        if (seconds < exports.MIN_SCHEDULE_SECONDS || seconds > exports.MAX_SCHEDULE_SECONDS)
            fail('scheduleDelay');
        env.effects.add('schedule', { name: scheduleName(name), id: scheduleId(id), seconds, data: JSON.parse(json) });
        return null;
    });
    def('cancelScheduledCC', 2, 2, (env, name, id) => { env.effects.add('cancelSchedule', { name: scheduleName(name), id: scheduleId(id) }); return null; });
}

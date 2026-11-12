"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROW_LIMIT = exports.MEMBER_LIMIT = exports.SYNC_TYPES = void 0;
exports.kindsOf = kindsOf;
exports.levelOf = levelOf;
exports.runSync = runSync;
const activityLeaderboard_1 = require("./activityLeaderboard");
/** The values of the option `type`, in the order they are offered. */
exports.SYNC_TYPES = ['roles', 'voice-roles', 'levels', 'messages', 'all'];
const ALL_KINDS = ['levels', 'roles', 'voice-roles', 'messages'];
/** The kinds a `type` stands for, in the order they are done (levels first, so the roles are given for the new levels); a word that is not one is `roles`, what the command did before. */
function kindsOf(type) {
    const word = String(type ?? 'roles').toLowerCase();
    if (word === 'all')
        return [...ALL_KINDS];
    const kind = ALL_KINDS.find((each) => each === word);
    return [kind ?? 'roles'];
}
/** Members whose roles are looked at (Petto asks Discord for each of them), and rows whose levels are calculated. A bigger server runs it again. */
exports.MEMBER_LIMIT = 10000;
exports.ROW_LIMIT = 20000;
const PAGE = 100;
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const usersDb = require('../db/levelUsers');
const { levelForXp } = require('./levelCurve');
const { getVoiceConfig } = require('./levelSource');
const actions = require('./levelActions');
const logger = require('./logger');
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** The level that an amount of XP is worth for a kind (`config` is the one of the kind), never above its maximum. */
function levelOf(xp, config) {
    const amount = Math.max(0, Number(xp) || 0);
    return Math.min(levelForXp(amount, config), Number(config.max_level ?? 1000));
}
/**
 * Does what was asked for the whole server. The members are read in pages by user id; the Discord work (roles) stops after `MEMBER_LIMIT` members, the database work
 * after `ROW_LIMIT` rows, and `limited` says so. `pause` is the wait after some roles were given, so a server with many does not hit the limits of Discord.
 */
async function runSync(guild, config, kinds, { pause = wait } = {}) {
    const result = { kinds: [...kinds], checked: 0, roles: 0, voiceRoles: 0, levels: 0, messages: 0, limited: false, skipped: {} };
    const wants = (kind) => kinds.includes(kind);
    const voiceConfig = getVoiceConfig(config);
    // The counter of messages is one statement of the database: it needs no member and no page.
    if (wants('messages')) {
        const blocked = (0, activityLeaderboard_1.statsReason)(guild.id);
        if (blocked)
            result.skipped.messages = blocked;
        else
            result.messages = await usersDb.raiseMessagesFromStats(guild.id);
    }
    const needsRows = wants('levels') || wants('roles') || wants('voice-roles');
    if (!needsRows)
        return result;
    const needsMembers = wants('roles') || wants('voice-roles');
    const limit = needsMembers ? exports.MEMBER_LIMIT : exports.ROW_LIMIT;
    // Only the members with a level can be given a role; to calculate levels, everybody with a row is needed.
    const list = wants('levels') ? usersDb.listForSync : usersDb.listWithLevels;
    let sinceBreak = 0;
    for (let offset = 0; result.checked < limit; offset += PAGE) {
        const page = await list(guild.id, { offset, limit: PAGE });
        if (!page.length)
            break;
        const members = needsMembers ? await guild.members.fetch({ user: page.map((row) => row.user_id) }).catch(() => null) : null;
        for (const row of page) {
            const member = members?.get(row.user_id) ?? null;
            if (needsMembers && !member)
                continue; // who left has nobody to give a role to
            let level = Number(row.level ?? 0);
            let voiceLevel = Number(row.voice_level ?? 0);
            if (wants('levels')) {
                const newLevel = levelOf(row.xp, config);
                const newVoiceLevel = levelOf(row.voice_xp, voiceConfig);
                let changed = false;
                if (newLevel !== level) {
                    await usersDb.setLevel(guild.id, row.user_id, newLevel);
                    level = newLevel;
                    changed = true;
                }
                if (newVoiceLevel !== voiceLevel) {
                    await usersDb.setVoiceLevel(guild.id, row.user_id, newVoiceLevel);
                    voiceLevel = newVoiceLevel;
                    changed = true;
                }
                if (changed)
                    result.levels += 1;
            }
            result.checked += 1;
            if (member && wants('roles') && level > 0 && await actions.checkRewards(guild, member, level, config, 'text').catch((error) => { logger.warn(`Sync: roles of ${row.user_id} in ${guild.id}: ${error.message}`); return null; })) {
                result.roles += 1;
                sinceBreak += 1;
            }
            if (member && wants('voice-roles') && voiceLevel > 0 && await actions.checkRewards(guild, member, voiceLevel, voiceConfig, 'voice').catch((error) => { logger.warn(`Sync: voice roles of ${row.user_id} in ${guild.id}: ${error.message}`); return null; })) {
                result.voiceRoles += 1;
                sinceBreak += 1;
            }
            if (sinceBreak >= 5) {
                sinceBreak = 0;
                await pause(400);
            }
        }
        if (page.length < PAGE)
            break;
    }
    result.limited = result.checked >= limit;
    return result;
}

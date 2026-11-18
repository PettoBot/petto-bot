"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dueChanges = dueChanges;
exports.runGuild = runGuild;
exports.runAgedRoles = runAgedRoles;
const agedRoles_1 = require("../db/agedRoles");
__exportStar(require("../db/agedRoles"), exports);
const { getPrimaryPool } = require('../db/postgres');
const logger = require('./logger');
const DAY_MS = 86_400_000;
/** What a member should get now: the roles to give and the roles to take away, from the rules (pure: no Discord here). */
function dueChanges(member, rules, now) {
    const add = [];
    const remove = [];
    if (member.joinedTimestamp === null)
        return { add, remove };
    const age = now - member.joinedTimestamp;
    for (const rule of rules) {
        if (!rule.enabled)
            continue;
        if (rule.target === 'humans' && member.bot)
            continue;
        if (rule.target === 'bots' && !member.bot)
            continue;
        if (age < rule.days * DAY_MS)
            continue;
        if (!member.roleIds.has(rule.roleId) && !add.some((a) => a.roleId === rule.roleId))
            add.push({ roleId: rule.roleId, rule });
        if (rule.removeRoleId && member.roleIds.has(rule.removeRoleId) && !remove.some((r) => r.roleId === rule.removeRoleId))
            remove.push({ roleId: rule.removeRoleId, rule });
    }
    return { add, remove };
}
const PER_GUILD_PER_RUN = 200; // role changes in one server in one look: the rest wait for the next one (a big server is done in a few hours, never in a burst)
const GAP_MS = Number(process.env.PETTO_AGED_ROLES_GAP_MS ?? 400); // the pause between two changes (a test sets it to 0)
const MAX_MEMBERS = 100_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const complained = new Map(); // `${guild}:${role}` -> when it was said
function complainOnce(key, text) {
    if (Date.now() - (complained.get(key) ?? 0) < 6 * 3_600_000)
        return;
    if (complained.size > 500)
        complained.clear();
    complained.set(key, Date.now());
    logger.warn(text);
}
/** One server: the members who are due get or lose their roles, up to `PER_GUILD_PER_RUN` changes. */
async function runGuild(guild, now = Date.now()) {
    const rules = (await (0, agedRoles_1.rulesOf)(guild.id)).filter((rule) => rule.enabled);
    if (!rules.length)
        return 0;
    if (guild.memberCount > MAX_MEMBERS) {
        complainOnce(`${guild.id}:big`, `Aged roles: guild ${guild.id} has more than ${MAX_MEMBERS} members, skipped.`);
        return 0;
    }
    const me = guild.members.me;
    const usable = (roleId) => {
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            complainOnce(`${guild.id}:${roleId}`, `Aged roles: the role ${roleId} of guild ${guild.id} does not exist any more.`);
            return false;
        }
        if (role.managed || (me && role.position >= me.roles.highest.position)) {
            complainOnce(`${guild.id}:${roleId}`, `Aged roles: Petto cannot give or take the role ${roleId} in guild ${guild.id} (managed, or above its own role).`);
            return false;
        }
        return true;
    };
    const members = await guild.members.fetch().catch(() => guild.members.cache);
    let changes = 0;
    for (const member of members.values()) {
        if (changes >= PER_GUILD_PER_RUN)
            break;
        const due = dueChanges({ bot: member.user.bot, joinedTimestamp: member.joinedTimestamp ?? null, roleIds: new Set(member.roles.cache.keys()) }, rules, now);
        for (const { roleId, rule } of due.add) {
            if (!usable(roleId))
                continue;
            try {
                await member.roles.add(roleId, `Aged role: ${rule.days} days in the server`);
                changes += 1;
                await sleep(GAP_MS);
            }
            catch (error) {
                complainOnce(`${guild.id}:${roleId}:add`, `Aged roles: could not give ${roleId} in guild ${guild.id}: ${error.message}`);
            }
        }
        for (const { roleId, rule } of due.remove) {
            if (!usable(roleId))
                continue;
            try {
                await member.roles.remove(roleId, `Aged role: ${rule.days} days in the server`);
                changes += 1;
                await sleep(GAP_MS);
            }
            catch (error) {
                complainOnce(`${guild.id}:${roleId}:remove`, `Aged roles: could not take ${roleId} in guild ${guild.id}: ${error.message}`);
            }
        }
    }
    return changes;
}
/** Every server that has rules, one after the other. */
async function runAgedRoles(client) {
    const { rows } = await getPrimaryPool().query('select distinct guild_id from aged_roles where enabled');
    for (const row of rows) {
        const guild = client.guilds.cache.get(String(row.guild_id));
        if (!guild)
            continue;
        try {
            await runGuild(guild);
        }
        catch (error) {
            logger.error(`Aged roles error in guild ${guild.id}:`, error);
        }
    }
}

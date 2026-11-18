"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULES = void 0;
exports.applyQuickSetup = applyQuickSetup;
// Quick Setup: the guided setup of the dashboard. The page asks for everything in seven steps and nothing changes until the last one; then it sends all the
// answers here, and this makes the channels and roles that were asked for ("create a new one") and saves the settings of each module with the same stores the
// commands use (logs, automod, welcome, auto role, tickets, verification), so what it makes can be changed afterwards from the usual pages of the dashboard.
// A module that fails does not stop the others: the answer says, for each one, what was done or why not.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/quickSetup.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
const { t, currentLanguage } = require('../i18n');
const logger = require('./logger');
const logConfig = require('../db/logConfig');
const automod = require('../db/automod');
const automodRules = require('../db/automodRules');
const memberEvents = require('../db/memberEvents');
const joinRoles = require('../db/joinRoles');
const tickets = require('../db/tickets');
const { guildLimit } = require('../db/premium');
const { ensureGuild } = require('../db/guilds');
const { buildPanelRows, buildPanelFallbackCard } = require('./ticketCards');
const verifyJobs = require('./verifyJobs');
exports.MODULES = ['moderation', 'automod', 'welcome', 'autorole', 'tickets', 'verification'];
const SNOWFLAKE = /^\d{15,25}$/;
const NEW = 'new';
/** `new` (make one), a real id, or nothing. */
const pick = (value) => (value === NEW ? NEW : SNOWFLAKE.test(String(value ?? '')) ? String(value) : null);
async function privateTextChannel(guild, name, reason) {
    const me = guild.members.me;
    return guild.channels.create({
        name, type: discord_js_1.ChannelType.GuildText, reason,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            { id: me.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.EmbedLinks] },
        ],
    });
}
const publicTextChannel = (guild, name, reason) => guild.channels.create({ name, type: discord_js_1.ChannelType.GuildText, reason });
/** A text channel of this server that exists and where Petto can write, or null. */
async function usableChannel(guild, id) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel || !channel.isTextBased())
        return null;
    return channel.permissionsFor(guild.members.me)?.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages]) ? channel : null;
}
async function channelFor(guild, choice, makeName, privateChannel, reason) {
    if (choice === NEW)
        return privateChannel ? privateTextChannel(guild, makeName, reason) : publicTextChannel(guild, makeName, reason);
    return choice ? usableChannel(guild, choice) : null;
}
async function roleFor(guild, choice, makeName, reason) {
    if (choice === NEW)
        return guild.roles.create({ name: makeName, reason, permissions: [] });
    if (!choice)
        return null;
    const role = guild.roles.cache.get(choice) ?? (await guild.roles.fetch(choice).catch(() => null));
    return role && !role.managed && role.id !== guild.id ? role : null;
}
/** An answer for the person (the text is already in their language): the other errors are logged and shown with a general text. */
class SetupError extends Error {
}
const fail = (lang, key, values) => { throw new SetupError(t(lang, key, values)); };
const STEPS = {
    async moderation(guild, input, lang) {
        const channel = await channelFor(guild, pick(input.moderation?.log_channel), t(lang, 'quicksetup.name.modLog'), true, t(lang, 'quicksetup.reason'));
        if (!channel)
            return fail(lang, 'quicksetup.err.channel');
        await ensureGuild(guild.id);
        await logConfig.addEntries(guild.id, channel.id, ['sanctions', 'automod', 'members', 'roles', 'channels', 'server']);
        return t(lang, 'quicksetup.done.moderation', { channel: `<#${channel.id}>` });
    },
    async automod(guild, input, lang) {
        const o = input.automod ?? {};
        await ensureGuild(guild.id);
        if (o.spam !== false)
            await automod.upsertConfig(guild.id, { anti_spam_enabled: true });
        const wanted = [...(o.invites ? ['invites'] : []), ...(o.scam ? ['scam'] : []), ...(o.links ? ['links'] : [])];
        const have = new Set((await automodRules.listRules(guild.id)).map((rule) => rule.template));
        for (const template of wanted) {
            if (have.has(template))
                continue;
            await automodRules.createRule(guild.id, { name: template, template, options: {}, action: 'delete', mute_minutes: 10, exempt_role_ids: [], exempt_channel_ids: [] });
        }
        return t(lang, 'quicksetup.done.automod', { count: wanted.length + (o.spam !== false ? 1 : 0) });
    },
    async welcome(guild, input, lang) {
        const o = input.welcome ?? {};
        const channel = await channelFor(guild, pick(o.channel), t(lang, 'quicksetup.name.welcome'), false, t(lang, 'quicksetup.reason'));
        if (!channel)
            return fail(lang, 'quicksetup.err.channel');
        const message = String(o.message ?? '').replace(/\u0000/g, '').trim().slice(0, 1800) || t(lang, 'welcome.default.welcome');
        await ensureGuild(guild.id);
        await memberEvents.upsertConfig(guild.id, {
            welcome_channel_id: channel.id, welcome_message: message,
            ...(o.goodbye ? { leave_channel_id: channel.id, leave_message: t(lang, 'quicksetup.goodbye') } : {}),
        });
        return t(lang, 'quicksetup.done.welcome', { channel: `<#${channel.id}>` });
    },
    async autorole(guild, input, lang) {
        const role = await roleFor(guild, pick(input.autorole?.role), t(lang, 'quicksetup.name.member'), t(lang, 'quicksetup.reason'));
        if (!role)
            return fail(lang, 'quicksetup.err.role');
        const me = guild.members.me;
        if ('position' in role && role.position >= me.roles.highest.position)
            return fail(lang, 'quicksetup.err.roleHigh', { role: `<@&${role.id}>` });
        await ensureGuild(guild.id);
        await joinRoles.addRole(guild.id, role.id, 'all');
        return t(lang, 'quicksetup.done.autorole', { role: `<@&${role.id}>` });
    },
    async tickets(guild, input, lang) {
        const o = input.tickets ?? {};
        const supportRole = await roleFor(guild, pick(o.support_role), t(lang, 'quicksetup.name.support'), t(lang, 'quicksetup.reason'));
        if (!supportRole)
            return fail(lang, 'quicksetup.err.role');
        const channel = await channelFor(guild, pick(o.channel), t(lang, 'quicksetup.name.tickets'), false, t(lang, 'quicksetup.reason'));
        if (!channel || !channel.isTextBased())
            return fail(lang, 'quicksetup.err.channel');
        const allowed = await guildLimit(guild.id, 'ticketCategories');
        if ((await tickets.listCategories(guild.id)).length + 1 > allowed.limit)
            return fail(lang, 'quicksetup.err.ticketLimit');
        await ensureGuild(guild.id);
        const title = t(lang, 'tickets.setup.default.title');
        const description = t(lang, 'tickets.setup.default.description');
        const panel = await tickets.createPanel({ guildId: guild.id, channelId: channel.id, title, description, embedTemplate: null, style: 'button' });
        const category = await tickets.createCategory({ guildId: guild.id, panelId: panel.id, key: 'support', label: t(lang, 'tickets.setup.default.typeLabel'), emoji: null, buttonStyle: 'primary', description: null, supportRoleIds: [supportRole.id], welcomeMessage: null });
        const sent = await channel.send({
            components: [buildPanelFallbackCard({ title, description, lang }), ...buildPanelRows('button', [category], { lang })], flags: discord_js_1.MessageFlags.IsComponentsV2,
        });
        await tickets.setPanelMessageId(panel.id, sent.id);
        return t(lang, 'quicksetup.done.tickets', { channel: `<#${channel.id}>`, role: `<@&${supportRole.id}>` });
    },
    async verification(guild, _input, lang) {
        // It edits every channel of the server, so it runs as the job the Verification page uses and finishes by itself.
        verifyJobs.startVerifyJob(guild, 'setup');
        return t(lang, 'quicksetup.done.verification');
    },
};
/** Applies what the dashboard asked for. `modules` says which steps are on; the rest of the input holds the answers of each one. */
async function applyQuickSetup(guild, input) {
    const lang = currentLanguage();
    const results = [];
    for (const module of exports.MODULES) {
        if (!input.modules?.[module])
            continue;
        try {
            results.push({ module, ok: true, message: await STEPS[module](guild, input, lang) });
        }
        catch (error) {
            logger.warn(`Quick Setup: ${module} failed in ${guild.id}: ${error.message}`);
            results.push({ module, ok: false, message: error instanceof SetupError ? error.message : error.code === 50013 ? t(lang, 'quicksetup.err.permission') : t(lang, 'quicksetup.err.failed') });
        }
    }
    return results;
}

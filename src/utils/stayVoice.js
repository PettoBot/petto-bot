"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.targetOf = exports.forget = exports.canSetStatus = exports.statusText = void 0;
exports.problemWith = problemWith;
exports.writeStatus = writeStatus;
exports.ensure = ensure;
exports.release = release;
exports.tick = tick;
exports.onBotMoved = onBotMoved;
// i18n-ignore-file: the texts of the command are in the catalogs (stayvoice.*); the lines here only go to the log of the team.
// Stay in voice: Petto stays in one voice channel of a server for good ("24/7"), with a status on the channel. The row of the server is in db/stayVoice.ts; the command is
// commands/utility/247.ts, the job that brings Petto back when it is out of the channel is jobs/stayVoiceJob.ts, and the event that does it at once is events/voiceStateUpdateStayVoice.ts.
// Petto does not play anything here: it asks Discord (the voice state of the gateway) to put it in the channel, muted and, by default, with the sound off, and it asks again when it is not there.
// The music has its own connection (music/service.js): while it plays in the server, this waits, and it comes back when the music is over.
const discord_js_1 = require("discord.js");
const stayVoice_1 = require("../db/stayVoice");
const logger = require('./logger');
const { t, peekGuildLanguage } = require('../i18n');
const music = require('../music/node');
/** The opcode of the gateway that changes the voice state of the bot (join, move, leave). */
const VOICE_STATE_OP = 4;
const STATUS_EVERY_MS = 30 * 60_000;
const MAX_JOINS_PER_TICK = 8;
const JOIN_GAP_MS = 600;
const WAIT_JOIN_MS = 6_000;
/** What the job is keeping, by server: refreshed every time it looks, and by the command when it changes something. */
const targets = new Map();
const seen = new Map();
const noStatusPermission = new Set();
const reported = new Map();
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
/** The status of the channel as it is written: the text the server chose, or the default one in its language. */
const statusText = (row, lang) => row.status ?? t(lang, 'stayvoice.defaultStatus');
exports.statusText = statusText;
/** Whether Petto can join and stay in that channel, or what is missing. */
function problemWith(channel, guild) {
    if (!channel || (channel.type !== discord_js_1.ChannelType.GuildVoice))
        return 'notVoice';
    const permissions = channel.permissionsFor(guild.members.me ?? guild.client.user);
    if (!permissions?.has(discord_js_1.PermissionFlagsBits.ViewChannel))
        return 'view';
    if (!permissions.has(discord_js_1.PermissionFlagsBits.Connect))
        return 'connect';
    return null;
}
/** Whether Petto may write the status of that channel (it needs "Set Voice Channel Status"; a server that did not give it just has no status). */
const canSetStatus = (channel, guild) => channel.permissionsFor(guild.members.me ?? guild.client.user)?.has(discord_js_1.PermissionFlagsBits.SetVoiceChannelStatus) === true;
exports.canSetStatus = canSetStatus;
/** Asks Discord to put Petto in the channel (or, with `null`, to take it out). Never throws. */
function sendVoiceState(guild, channelId, deaf) {
    try {
        const shard = guild.shard;
        if (!shard)
            return false;
        shard.send({ op: VOICE_STATE_OP, d: { guild_id: guild.id, channel_id: channelId, self_mute: true, self_deaf: deaf } }, true);
        return true;
    }
    catch (error) {
        logger.warn(`Stay in voice: could not ask Discord to change the voice state of ${guild.id}: ${error?.message ?? error}`);
        return false;
    }
}
const inChannel = (guild, channelId) => guild.members.me?.voice.channelId === channelId;
const musicIsPlaying = (guildId) => Boolean(music.get()?.players?.has(guildId));
/** Writes (or, with `null`, clears) the status of a voice channel. Never throws. */
async function writeStatus(client, channelId, text) {
    if (text && noStatusPermission.has(channelId))
        return false;
    try {
        await client.rest.put(`/channels/${channelId}/voice-status`, { body: { status: text ?? '' } });
        noStatusPermission.delete(channelId);
        return true;
    }
    catch (error) {
        const failure = error;
        if (failure.code === 50013 || failure.status === 403) {
            if (!noStatusPermission.has(channelId))
                logger.info(`Stay in voice: no permission to set the status of the voice channel ${channelId}`);
            noStatusPermission.add(channelId);
        }
        else if (failure.status !== 404) {
            logger.warn(`Stay in voice: could not set the status of a voice channel: ${failure.message ?? error}`);
        }
        return false;
    }
}
/** Waits until Petto shows in the channel (the voice state comes back from Discord), up to a few seconds. */
async function waitInChannel(guild, channelId, ms = WAIT_JOIN_MS) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (inChannel(guild, channelId))
            return true;
        await sleep(400);
    }
    return inChannel(guild, channelId);
}
/**
 * Makes the server of `row` right now: joins the channel when Petto is not in it and writes the status. `force` also moves Petto when it is in another channel
 * (the command and the job do; a person moving Petto by hand is put back, because this is what "for good" means).
 */
async function ensure(client, row, { waitMs = WAIT_JOIN_MS } = {}) {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild)
        return { ok: false, reason: 'noGuild' };
    const channel = guild.channels.cache.get(row.channelId);
    const problem = problemWith(channel, guild);
    if (problem)
        return { ok: false, reason: problem };
    if (musicIsPlaying(guild.id))
        return { ok: false, reason: 'music' };
    targets.set(guild.id, row);
    const state = seen.get(guild.id) ?? { joinedAt: 0, statusAt: 0, statusText: null };
    let joined = inChannel(guild, row.channelId);
    const deafNow = guild.members.me?.voice.selfDeaf === true;
    if (!joined || deafNow !== row.deaf) {
        sendVoiceState(guild, row.channelId, row.deaf);
        joined = await waitInChannel(guild, row.channelId, waitMs);
        if (joined) {
            state.joinedAt = Date.now();
            state.statusAt = 0;
        }
    }
    seen.set(guild.id, state);
    if (!joined)
        return { ok: false, reason: 'notThere' };
    const text = (0, exports.statusText)(row, peekGuildLanguage(guild.id));
    if (!(0, exports.canSetStatus)(channel, guild))
        return { ok: true, status: 'noPermission' };
    if (state.statusText === text && Date.now() - state.statusAt < STATUS_EVERY_MS)
        return { ok: true, status: 'skipped' };
    const wrote = await writeStatus(client, row.channelId, text);
    if (wrote) {
        state.statusAt = Date.now();
        state.statusText = text;
    }
    return { ok: true, status: wrote ? 'written' : 'noPermission' };
}
/** Turns it off for a server: Petto leaves the channel and the status of the channel is cleared. */
async function release(client, guildId, channelId) {
    targets.delete(guildId);
    seen.delete(guildId);
    reported.delete(guildId);
    const guild = client.guilds.cache.get(guildId);
    if (!guild)
        return;
    if (channelId)
        await writeStatus(client, channelId, null);
    if (!channelId || inChannel(guild, channelId))
        sendVoiceState(guild, null, true);
}
/** One round of the job: every server with the switch on gets what it needs (Petto in its channel, the status written), a few at a time. */
async function tick(client) {
    const rows = await (0, stayVoice_1.listEnabled)();
    const wanted = new Set(rows.map((row) => row.guildId));
    for (const guildId of [...targets.keys()])
        if (!wanted.has(guildId)) {
            targets.delete(guildId);
            seen.delete(guildId);
            reported.delete(guildId);
        }
    let joined = 0;
    for (const row of rows) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild)
            continue;
        const needs = !inChannel(guild, row.channelId) || guild.members.me?.voice.selfDeaf !== row.deaf || (seen.get(row.guildId)?.statusAt ?? 0) + STATUS_EVERY_MS < Date.now();
        targets.set(row.guildId, row);
        if (!needs)
            continue;
        if (joined >= MAX_JOINS_PER_TICK && !inChannel(guild, row.channelId))
            continue;
        const before = inChannel(guild, row.channelId);
        const outcome = await ensure(client, row, { waitMs: 2_500 }).catch((error) => { logger.warn(`Stay in voice: ${row.guildId}: ${error?.message ?? error}`); return null; });
        if (!before && outcome?.ok) {
            joined += 1;
            await sleep(JOIN_GAP_MS);
        }
        // One line in the log each time the result of a server changes (never every round), so the team can see why Petto is not in a channel.
        const result = outcome ? (outcome.ok ? 'in' : outcome.reason) : 'error';
        if (reported.get(row.guildId) !== result) {
            reported.set(row.guildId, result);
            logger.info(outcome?.ok ? `Stay in voice: ${row.guildId} is in ${row.channelId}` : `Stay in voice: ${row.guildId} is not in ${row.channelId} (${result})`);
        }
    }
    return { checked: rows.length, joined };
}
/** Called by the event when the voice state of Petto changes: when it was taken out (or moved from) the channel it should stay in, it comes back in a few seconds. */
async function onBotMoved(client, guildId, leftChannelId) {
    const target = targets.get(guildId) ?? (await (0, stayVoice_1.getStay)(guildId).catch(() => null));
    if (!target?.enabled || leftChannelId !== target.channelId)
        return;
    await sleep(5_000);
    const row = await (0, stayVoice_1.getStay)(guildId).catch(() => null);
    if (!row?.enabled)
        return;
    const outcome = await ensure(client, row).catch(() => null);
    if (outcome && !outcome.ok && outcome.reason !== 'music')
        logger.info(`Stay in voice: ${guildId} could not come back (${outcome.reason})`);
}
/** For the checks. */
const forget = () => { targets.clear(); seen.clear(); noStatusPermission.clear(); reported.clear(); };
exports.forget = forget;
const targetOf = (guildId) => targets.get(guildId);
exports.targetOf = targetOf;

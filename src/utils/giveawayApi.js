// What the dashboard can do with giveaways: start one, change one that is running, end one now, or draw new winners of one that ended.
// It uses the same engine as /giveaway, so a giveaway started here is the same as one started from Discord.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const presetsDb = require('../db/giveawayPresets');
const configDb = require('../db/giveawayConfig');
const embedTemplatesDb = require('../db/embedTemplates');
const { ensureGuild } = require('../db/guilds');
const { parseDuration } = require('./duration');
const engine = require('./giveawayEngine');

const MAX_WINNERS = 50;
const MAX_PRIZE = 256;
const SNOWFLAKE = /^\d{15,25}$/;
const SENDABLE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const fail = (error, message) => ({ ok: false, status: 400, error, message });

async function startGiveaway(client, guildId, body) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { ok: false, status: 404, error: 'guild_not_found', message: 'Petto is not in that server.' };

  const prize = String(body.prize ?? '').trim().slice(0, MAX_PRIZE);
  if (!prize) return fail('invalid_prize', 'Write the prize.');
  const winnersCount = Number(body.winners);
  if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > MAX_WINNERS) return fail('invalid_winners', `Winners must be from 1 to ${MAX_WINNERS}.`);
  const durationMs = parseDuration(body.duration);
  if (!durationMs) return fail('invalid_duration', 'Write a duration such as 10m, 1h or 3d 4h.');
  const claimText = String(body.claim_time ?? '').trim();
  const claimTimeMs = claimText ? parseDuration(claimText) : null;
  if (claimText && !claimTimeMs) return fail('invalid_claim_time', 'Write the claim time as 5m or 1h.');
  const hostId = String(body.host_id ?? '');
  if (!SNOWFLAKE.test(hostId)) return fail('invalid_host', 'The host is not valid.');

  const channel = guild.channels.cache.get(String(body.channel_id ?? ''));
  if (!channel || !SENDABLE.has(channel.type)) return fail('invalid_channel', 'Pick a text channel.');
  const me = guild.members.me;
  const allowed = me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  if (!allowed) return fail('missing_permissions', 'I need View Channel, Send Messages and Embed Links in that channel.');

  await ensureGuild(guildId);
  const config = await configDb.ensureConfig(guildId);

  let presetId = null;
  const presetName = String(body.preset ?? '').trim();
  if (presetName) {
    const preset = await presetsDb.getPreset(guildId, presetName);
    if (!preset) return fail('unknown_preset', `The preset "${presetName}" does not exist.`);
    presetId = preset.id;
  }
  const embedTemplate = String(body.embed_template ?? '').trim();
  if (embedTemplate && !(await embedTemplatesDb.getTemplate(guildId, embedTemplate))) return fail('unknown_design', `The design "${embedTemplate}" does not exist.`);
  const entryMode = body.entry_mode === 'reaction' || body.entry_mode === 'button' ? body.entry_mode : config.entry_mode;

  const giveaway = await engine.startGiveaway({
    guild, channel, hostId, prize, winnersCount, endsAt: new Date(Date.now() + durationMs), claimTimeMs,
    entryMode, reaction: config.reaction, presetId, embedTemplate: embedTemplate || config.embed_template,
  });
  return { ok: true, id: giveaway.id, message_id: giveaway.message_id, channel_id: channel.id };
}

async function findOwned(guildId, id) {
  const giveaway = Number.isInteger(id) && id > 0 ? await giveawaysDb.getGiveaway(id) : null;
  return giveaway && giveaway.guild_id === guildId ? giveaway : null;
}

/** Changes the prize, the number of winners or the end of a giveaway that is still running; what is left empty stays as it is. */
async function editGiveaway(client, guildId, body) {
  const giveaway = await findOwned(guildId, Number(body.id));
  if (!giveaway) return { ok: false, status: 404, error: 'not_found', message: 'That giveaway does not exist.' };
  if (giveaway.ended) return fail('already_ended', 'That giveaway already ended.');

  const patch = {};
  const prize = String(body.prize ?? '').trim();
  if (prize) patch.prize = prize.slice(0, MAX_PRIZE);

  const winnersText = String(body.winners ?? '').trim();
  if (winnersText) {
    const winnersCount = Number(winnersText);
    if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > MAX_WINNERS) return fail('invalid_winners', `Winners must be from 1 to ${MAX_WINNERS}.`);
    patch.winners_count = winnersCount;
  }

  const durationText = String(body.duration ?? '').trim();
  if (durationText) {
    const durationMs = parseDuration(durationText);
    if (!durationMs) return fail('invalid_duration', 'Write a duration such as 10m, 1h or 3d 4h.');
    patch.ends_at = new Date(Date.now() + durationMs).toISOString();
  }

  if (!Object.keys(patch).length) return fail('nothing_to_change', 'Change at least one field.');

  const updated = await giveawaysDb.updateGiveaway(giveaway.id, patch);
  const channel = client.guilds.cache.get(guildId)?.channels.cache.get(giveaway.channel_id) ?? await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel) await engine.refreshGiveawayMessage(channel, updated);
  return { ok: true };
}

async function endGiveaway(client, guildId, body) {
  const giveaway = await findOwned(guildId, Number(body.id));
  if (!giveaway) return { ok: false, status: 404, error: 'not_found', message: 'That giveaway does not exist.' };
  if (giveaway.ended) return fail('already_ended', 'That giveaway already ended.');
  await engine.endGiveaway(client, giveaway);
  return { ok: true };
}

async function rerollGiveaway(client, guildId, body) {
  const giveaway = await findOwned(guildId, Number(body.id));
  if (!giveaway) return { ok: false, status: 404, error: 'not_found', message: 'That giveaway does not exist.' };
  if (!giveaway.ended) return fail('still_running', 'That giveaway is still running. End it first.');
  const count = body.winners === undefined || body.winners === '' ? undefined : Number(body.winners);
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_WINNERS)) return fail('invalid_winners', `Winners must be from 1 to ${MAX_WINNERS}.`);
  try {
    const winners = await engine.rerollGiveaway(client, giveaway, count);
    return { ok: true, winners };
  } catch (error) {
    if (error?.userFacing) return fail('reroll_failed', error.message);
    throw error;
  }
}

/** Runs one action of the dashboard. Returns { ok, status?, error?, message?, ... }. */
async function runGiveawayAction(client, guildId, action, body = {}) {
  if (action === 'start') return startGiveaway(client, guildId, body);
  if (action === 'edit') return editGiveaway(client, guildId, body);
  if (action === 'end') return endGiveaway(client, guildId, body);
  if (action === 'reroll') return rerollGiveaway(client, guildId, body);
  return { ok: false, status: 404, error: 'unknown_action', message: 'That action does not exist.' };
}

module.exports = { runGiveawayAction, MAX_WINNERS };

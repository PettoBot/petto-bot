// What the dashboard can do with giveaways: start one, change one that is running, end one now, or draw new winners of one that ended.
// It uses the same engine as /giveaway, so a giveaway started here is the same as one started from Discord.
// Each answer has a code (`error`) the website can match and a `message` for people in `lang` (the language of the request); what
// the engine posts in Discord follows the server's language.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const presetsDb = require('../db/giveawayPresets');
const configDb = require('../db/giveawayConfig');
const embedTemplatesDb = require('../db/embedTemplates');
const { ensureGuild } = require('../db/guilds');
const { parseDuration } = require('./duration');
const engine = require('./giveawayEngine');
const { t, currentLanguage } = require('../i18n');

const MAX_WINNERS = 50;
const MAX_PRIZE = 256;
const SNOWFLAKE = /^\d{15,25}$/;
const SENDABLE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const fail = (error, message) => ({ ok: false, status: 400, error, message });

async function startGiveaway(client, guildId, body, lang) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { ok: false, status: 404, error: 'guild_not_found', message: t(lang, 'web.giveaway.notInServer') };

  const prize = String(body.prize ?? '').trim().slice(0, MAX_PRIZE);
  if (!prize) return fail('invalid_prize', t(lang, 'web.giveaway.writePrize'));
  const winnersCount = Number(body.winners);
  if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > MAX_WINNERS) return fail('invalid_winners', t(lang, 'web.giveaway.winnersRange', { max: MAX_WINNERS }));
  const durationMs = parseDuration(body.duration);
  if (!durationMs) return fail('invalid_duration', t(lang, 'web.giveaway.duration'));
  const claimText = String(body.claim_time ?? '').trim();
  const claimTimeMs = claimText ? parseDuration(claimText) : null;
  if (claimText && !claimTimeMs) return fail('invalid_claim_time', t(lang, 'web.giveaway.claimTime'));
  const hostId = String(body.host_id ?? '');
  if (!SNOWFLAKE.test(hostId)) return fail('invalid_host', t(lang, 'web.giveaway.invalidHost'));

  const channel = guild.channels.cache.get(String(body.channel_id ?? ''));
  if (!channel || !SENDABLE.has(channel.type)) return fail('invalid_channel', t(lang, 'web.giveaway.pickChannel'));
  const me = guild.members.me;
  const allowed = me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  if (!allowed) return fail('missing_permissions', t(lang, 'web.giveaway.permissions'));

  await ensureGuild(guildId);
  const config = await configDb.ensureConfig(guildId);

  let presetId = null;
  const presetName = String(body.preset ?? '').trim();
  if (presetName) {
    const preset = await presetsDb.getPreset(guildId, presetName);
    if (!preset) return fail('unknown_preset', t(lang, 'web.giveaway.unknownPreset', { name: presetName }));
    presetId = preset.id;
  }
  const embedTemplate = String(body.embed_template ?? '').trim();
  if (embedTemplate && !(await embedTemplatesDb.getTemplate(guildId, embedTemplate))) return fail('unknown_design', t(lang, 'web.giveaway.unknownDesign', { name: embedTemplate }));
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
async function editGiveaway(client, guildId, body, lang) {
  const giveaway = await findOwned(guildId, Number(body.id));
  if (!giveaway) return { ok: false, status: 404, error: 'not_found', message: t(lang, 'web.giveaway.notFound') };
  if (giveaway.ended) return fail('already_ended', t(lang, 'web.giveaway.alreadyEnded'));

  const patch = {};
  const prize = String(body.prize ?? '').trim();
  if (prize) patch.prize = prize.slice(0, MAX_PRIZE);

  const winnersText = String(body.winners ?? '').trim();
  if (winnersText) {
    const winnersCount = Number(winnersText);
    if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > MAX_WINNERS) return fail('invalid_winners', t(lang, 'web.giveaway.winnersRange', { max: MAX_WINNERS }));
    patch.winners_count = winnersCount;
  }

  const durationText = String(body.duration ?? '').trim();
  if (durationText) {
    const durationMs = parseDuration(durationText);
    if (!durationMs) return fail('invalid_duration', t(lang, 'web.giveaway.duration'));
    patch.ends_at = new Date(Date.now() + durationMs).toISOString();
  }

  if (!Object.keys(patch).length) return fail('nothing_to_change', t(lang, 'web.giveaway.nothingToChange'));

  const updated = await giveawaysDb.updateGiveaway(giveaway.id, patch);
  const channel = client.guilds.cache.get(guildId)?.channels.cache.get(giveaway.channel_id) ?? await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel) await engine.refreshGiveawayMessage(channel, updated);
  return { ok: true };
}

async function endGiveaway(client, guildId, body, lang) {
  const giveaway = await findOwned(guildId, Number(body.id));
  if (!giveaway) return { ok: false, status: 404, error: 'not_found', message: t(lang, 'web.giveaway.notFound') };
  if (giveaway.ended) return fail('already_ended', t(lang, 'web.giveaway.alreadyEnded'));
  await engine.endGiveaway(client, giveaway);
  return { ok: true };
}

async function rerollGiveaway(client, guildId, body, lang) {
  const giveaway = await findOwned(guildId, Number(body.id));
  if (!giveaway) return { ok: false, status: 404, error: 'not_found', message: t(lang, 'web.giveaway.notFound') };
  if (!giveaway.ended) return fail('still_running', t(lang, 'web.giveaway.stillRunning'));
  const count = body.winners === undefined || body.winners === '' ? undefined : Number(body.winners);
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_WINNERS)) return fail('invalid_winners', t(lang, 'web.giveaway.winnersRange', { max: MAX_WINNERS }));
  try {
    const winners = await engine.rerollGiveaway(client, giveaway, count, lang);
    return { ok: true, winners };
  } catch (error) {
    if (error?.userFacing) return fail('reroll_failed', error.message);
    throw error;
  }
}

/** Runs one action of the dashboard. Returns { ok, status?, error?, message?, ... }, the message in `lang`. */
async function runGiveawayAction(client, guildId, action, body = {}, lang = currentLanguage()) {
  if (action === 'start') return startGiveaway(client, guildId, body, lang);
  if (action === 'edit') return editGiveaway(client, guildId, body, lang);
  if (action === 'end') return endGiveaway(client, guildId, body, lang);
  if (action === 'reroll') return rerollGiveaway(client, guildId, body, lang);
  return { ok: false, status: 404, error: 'unknown_action', message: t(lang, 'web.giveaway.unknownAction') };
}

module.exports = { runGiveawayAction, MAX_WINNERS };

// Making counters: the locked channel (everyone sees it, nobody joins or writes), the saved row, the limits and the quick
// "server stats" preset. Used by `!counter` and by the dashboard route, so both make the same counters.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const countersDb = require('../db/counters');
const { getGuildPremium, getGuildLimits } = require('../db/premium');
const { resolveOption, resolveFormat, validTimeZone, defaultTemplate, renderName } = require('./counterNames');
const { countGuild, extrasFor } = require('./counterValues');
const { t } = require('../i18n');

const KINDS = { voice: ChannelType.GuildVoice, text: ChannelType.GuildText, category: ChannelType.GuildCategory, announce: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice };
const KIND_OF_TYPE = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announce', 13: 'stage' };
const PRESET = ['members', 'users_only', 'bots_only'];

async function counterLimits(guildId) {
  const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
  return { max: getGuildLimits(premium).counters ?? 6, premium: Boolean(premium?.active), premiumMax: getGuildLimits({ active: true }).counters ?? 25 };
}

/** Everyone can see a counter, nobody can join, talk or write in it; Petto keeps what it needs to rename it. */
function lockedOverwrites(guild, kind) {
  const deny = kind === 'text' || kind === 'announce'
    ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.AddReactions]
    : kind === 'category' ? [] : [PermissionFlagsBits.Connect];
  const overwrites = [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny }];
  const me = guild.members?.me;
  if (me) overwrites.push({ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, ...(kind === 'voice' || kind === 'stage' ? [PermissionFlagsBits.Connect] : [])] });
  return overwrites;
}

/** The name a counter would show right now (for previews and the first name of a new channel). */
function previewName(guild, row, lang) {
  const value = countGuild(guild, row.counter_option, lang, row);
  return renderName(row, value, lang, extrasFor(guild, row, value));
}

/**
 * Makes a counter. `input`: { type, template, format, kind, categoryId, channelId (use an existing channel), roleId, goal,
 * timezone, prefix, suffix, interval, createdBy, reason }. Returns { ok, row, channel, name } or { ok: false, error, ... }.
 */
async function createCounter(guild, input, lang) {
  const option = resolveOption(input.type);
  if (!option) return { ok: false, error: 'unknownType', type: String(input.type ?? '') };
  if (option === 'role_members' && !(input.roleId && guild.roles.cache.get(input.roleId))) return { ok: false, error: 'needRole' };
  if (input.timezone && !validTimeZone(input.timezone)) return { ok: false, error: 'badTimezone', zone: input.timezone };
  const format = resolveFormat(input.format) ?? 'plain';
  const goal = Number.isInteger(Number(input.goal)) && Number(input.goal) > 0 ? Math.min(2_000_000_000, Number(input.goal)) : null;

  const existing = await countersDb.list(guild.id);
  const limits = await counterLimits(guild.id);
  if (existing.length >= limits.max) return { ok: false, error: limits.premium ? 'limit' : 'limitFree', count: limits.max, premium: limits.premiumMax };

  let parent = null;
  if (input.categoryId) {
    parent = guild.channels.cache.get(input.categoryId);
    if (!parent || parent.type !== ChannelType.GuildCategory) return { ok: false, error: 'notCategory' };
  }

  const row = {
    guild_id: guild.id, counter_option: option, created_by: input.createdBy,
    name_template: String(input.template ?? '').trim().slice(0, 100) || defaultTemplate(option, lang),
    number_format: format, target_id: option === 'role_members' ? input.roleId : null, goal, timezone: input.timezone || null,
    prefix: String(input.prefix ?? '').slice(0, 30), suffix: String(input.suffix ?? '').slice(0, 30),
    interval_seconds: Math.max(60, Math.min(86400, Number(input.interval) || 60)), parent_id: parent?.id ?? null,
  };
  const name = previewName(guild, row, lang);

  let channel;
  if (input.channelId) {
    channel = guild.channels.cache.get(input.channelId);
    if (!channel || !KIND_OF_TYPE[channel.type]) return { ok: false, error: 'notChannel' };
    if (existing.some((r) => r.channel_id === channel.id)) return { ok: false, error: 'alreadyCounter', channel };
  } else {
    const kind = KINDS[input.kind] !== undefined ? input.kind : 'voice';
    try {
      channel = await guild.channels.create({ name, type: KINDS[kind], parent: parent?.id, permissionOverwrites: lockedOverwrites(guild, kind), reason: input.reason });
    } catch (err) {
      return { ok: false, error: err?.code === 50013 ? 'permission' : 'discord', detail: err?.message ?? '' };
    }
  }
  const saved = await countersDb.add({ ...row, channel_id: channel.id, channel_type: KIND_OF_TYPE[channel.type] ?? 'voice', parent_id: row.parent_id ?? channel.parentId ?? null });
  return { ok: true, row: saved, channel, name, existing: Boolean(input.channelId) };
}

/** The quick preset: a "Server stats" category with members, humans and bots, all locked. Skipped when the server already has counters. */
async function setupPreset(guild, { createdBy, reason }, lang) {
  const existing = await countersDb.list(guild.id);
  if (existing.length) return { ok: false, error: 'already', count: existing.length };
  const limits = await counterLimits(guild.id);
  let category;
  try {
    category = await guild.channels.create({ name: t(lang, 'counters.setup.category'), type: ChannelType.GuildCategory, permissionOverwrites: lockedOverwrites(guild, 'category'), position: 0, reason });
  } catch (err) {
    return { ok: false, error: err?.code === 50013 ? 'permission' : 'discord', detail: err?.message ?? '' };
  }
  const made = [];
  for (const type of PRESET.slice(0, limits.max)) {
    const result = await createCounter(guild, { type, kind: 'voice', categoryId: category.id, createdBy, reason }, lang);
    if (!result.ok) return { ok: false, error: result.error, detail: result.detail, made, category };
    made.push(result);
  }
  return { ok: true, category, made };
}

module.exports = { createCounter, setupPreset, counterLimits, previewName, lockedOverwrites, KINDS, KIND_OF_TYPE, PRESET };

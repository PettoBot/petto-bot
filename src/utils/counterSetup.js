// Making counters: the locked channel (everyone sees it, nobody joins or writes), the saved row, the limits and the quick
// "server stats" preset. Used by `!counter` and by the dashboard route, so both make the same counters.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const countersDb = require('../db/counters');
const { getGuildPremium, getGuildLimits } = require('../db/premium');
const { resolveOption, resolveFormat, validTimeZone, defaultTemplate, renderName, templateMax, NEEDS_ROLE } = require('./counterNames');
const { countGuild, extrasFor } = require('./counterValues');
const { t } = require('../i18n');

// `topic` is a text channel whose topic shows the value (its name stays as it is).
const KINDS = { voice: ChannelType.GuildVoice, text: ChannelType.GuildText, category: ChannelType.GuildCategory, announce: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice, topic: ChannelType.GuildText };
const KIND_ALIASES = { vc: 'voice', voz: 'voice', texto: 'text', categoria: 'category', categoría: 'category', cat: 'category', tema: 'topic', topico: 'topic', tópico: 'topic', description: 'topic', news: 'announce', announcement: 'announce', escenario: 'stage', palco: 'stage' }; // i18n-ignore: words people type
/** The channel kind a word means (`voice`, `topic`, `categoria`...), or null. */
function resolveKind(word) {
  const key = String(word ?? '').trim().toLowerCase();
  if (!key) return null;
  if (KINDS[key] !== undefined) return key;
  return KIND_ALIASES[key] ?? null;
}
/** Channels whose topic can show a counter: text and announcement channels. */
const TOPIC_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const KIND_OF_TYPE = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announce', 13: 'stage' };
const PRESET = ['members', 'users_only', 'bots_only'];
// One-click packs (`!counter setup <pack>` and the dashboard's gallery): each makes its category with its counters, skipping the types
// the server already counts and stopping at the plan's limit.
const PRESETS = {
  basic: ['members', 'users_only', 'bots_only'],
  boosts: ['boosts', 'booster_count', 'boost_level'],
  online: ['online', 'status_online', 'in_voice'],
  goal: ['goal'],
  clock: ['clock', 'date'],
};
const PRESET_ALIASES = {
  stats: 'basic', server: 'basic', members: 'basic', default: 'basic', miembros: 'basic', membros: 'basic', basico: 'basic', básico: 'basic',
  boost: 'boosts', mejoras: 'boosts', impulsos: 'boosts', nitro: 'boosts',
  activity: 'online', active: 'online', staff: 'online', conectados: 'online', voice: 'online',
  goals: 'goal', meta: 'goal', objetivo: 'goal', milestone: 'goal',
  time: 'clock', date: 'clock', hora: 'clock', reloj: 'clock', relogio: 'clock', relógio: 'clock',
};

/** The pack a name means (`boosts`, `meta`, `time`...), or null. */
function resolvePreset(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  if (PRESETS[key]) return key;
  return PRESET_ALIASES[key] ?? null;
}

/** The next round goal above a count: 87 -> 90, 940 -> 1,000, 5,234 -> 6,000, 48,000 -> 50,000. */
function nextGoal(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const step = n < 100 ? 10 : n < 1000 ? 100 : n < 10_000 ? 1000 : n < 100_000 ? 5000 : 10 ** (String(n).length - 2);
  return Math.floor(n / step) * step + step;
}

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
  if (NEEDS_ROLE.has(option) && !(input.roleId && guild.roles.cache.get(input.roleId))) return { ok: false, error: 'needRole' };
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

  const kindWord = input.kind ? resolveKind(input.kind) : null;
  if (input.kind && !kindWord) return { ok: false, error: 'unknownKind', kind: String(input.kind).slice(0, 30) };
  const target = kindWord === 'topic' || input.target === 'topic' ? 'topic' : 'name';
  const row = {
    guild_id: guild.id, counter_option: option, created_by: input.createdBy, target,
    name_template: String(input.template ?? '').trim().slice(0, templateMax({ target })) || defaultTemplate(option, lang),
    number_format: format, target_id: NEEDS_ROLE.has(option) ? input.roleId : null, goal, timezone: input.timezone || null,
    prefix: String(input.prefix ?? '').slice(0, 30), suffix: String(input.suffix ?? '').slice(0, 30),
    interval_seconds: Math.max(60, Math.min(86400, Number(input.interval) || 60)), parent_id: parent?.id ?? null,
  };
  const name = previewName(guild, row, lang);

  let channel;
  if (input.channelId) {
    channel = guild.channels.cache.get(input.channelId);
    if (!channel || !KIND_OF_TYPE[channel.type]) return { ok: false, error: 'notChannel' };
    if (existing.some((r) => r.channel_id === channel.id)) return { ok: false, error: 'alreadyCounter', channel };
    if (target === 'topic' && !TOPIC_TYPES.includes(channel.type)) return { ok: false, error: 'topicNeedsText' };
  } else {
    const kind = kindWord ?? 'voice';
    try {
      // A topic counter is a text channel with a name of its own; its topic shows the value.
      const channelName = kind === 'topic' ? t(lang, 'counters.topic.channelName') : name;
      channel = await guild.channels.create({ name: channelName, type: KINDS[kind], parent: kind === 'category' ? undefined : parent?.id, ...(kind === 'topic' ? { topic: name } : {}), permissionOverwrites: lockedOverwrites(guild, kind === 'topic' ? 'text' : kind), reason: input.reason });
    } catch (err) {
      return { ok: false, error: err?.code === 50013 ? 'permission' : 'discord', detail: err?.message ?? '' };
    }
  }
  const saved = await countersDb.add({ ...row, channel_id: channel.id, channel_type: KIND_OF_TYPE[channel.type] ?? 'voice', parent_id: row.parent_id ?? channel.parentId ?? null });
  return { ok: true, row: saved, channel, name, existing: Boolean(input.channelId) };
}

/**
 * A pack of counters in its own locked category. Without `preset` it is the first "Server stats" setup, skipped when the server already
 * has counters. A named pack (basic, boosts, online, goal, clock) adds what the server does not count yet, up to the plan's limit.
 * `goal` (for the goal pack) defaults to the next round number above the members; `timezone` is for the clock pack.
 */
async function setupPreset(guild, { createdBy, reason, preset = null, goal = null, timezone = null }, lang) {
  const named = preset !== null && preset !== undefined && String(preset).trim() !== '';
  const pack = named ? resolvePreset(preset) : 'basic';
  if (!pack) return { ok: false, error: 'unknownPreset', preset: String(preset).slice(0, 30), presets: Object.keys(PRESETS) };
  if (timezone && !validTimeZone(timezone)) return { ok: false, error: 'badTimezone', zone: timezone };
  const existing = await countersDb.list(guild.id);
  if (!named && existing.length) return { ok: false, error: 'already', count: existing.length };
  const limits = await counterLimits(guild.id);
  const counted = new Set(existing.map((row) => row.counter_option));
  const types = PRESETS[pack].filter((type) => type === 'goal' || !counted.has(type));
  if (!types.length) return { ok: false, error: 'presetHave', preset: pack };
  const room = limits.max - existing.length;
  if (room <= 0) return { ok: false, error: limits.premium ? 'limit' : 'limitFree', count: limits.max, premium: limits.premiumMax };
  let category;
  try {
    const name = pack === 'basic' ? t(lang, 'counters.setup.category') : t(lang, `counters.preset.${pack}.category`);
    category = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: lockedOverwrites(guild, 'category'), position: 0, reason });
  } catch (err) {
    return { ok: false, error: err?.code === 50013 ? 'permission' : 'discord', detail: err?.message ?? '' };
  }
  const target = Number.isInteger(Number(goal)) && Number(goal) > 0 ? Number(goal) : nextGoal(guild.memberCount ?? 0);
  const made = [];
  for (const type of types.slice(0, room)) {
    const result = await createCounter(guild, { type, kind: 'voice', categoryId: category.id, createdBy, reason, goal: type === 'goal' ? target : null, timezone: type === 'clock' || type === 'date' ? timezone : null, format: type === 'goal' || type === 'members' ? 'grouped' : null }, lang);
    if (!result.ok) return { ok: false, error: result.error, detail: result.detail, made, category };
    made.push(result);
  }
  return { ok: true, category, made, preset: pack, skipped: types.length - made.length };
}

module.exports = { createCounter, setupPreset, counterLimits, previewName, lockedOverwrites, resolvePreset, resolveKind, nextGoal, KINDS, KIND_OF_TYPE, TOPIC_TYPES, PRESET, PRESETS };

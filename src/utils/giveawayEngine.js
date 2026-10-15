const giveawaysDb = require('../db/giveaways');
const { sendAs } = require('./senderIdentity');
const levelUsersDb = require('../db/levelUsers');
const presetsDb = require('../db/giveawayPresets');
const { formatDuration } = require('./duration');
const { buildEntryCard, buildEnterRow, buildClaimRow, sendGiveawayResponse } = require('./giveawayCard');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, tn, currentLanguage, guildLanguage, runWithLanguage } = require('../i18n');

// The default messages (used when the server wrote none) are the catalog texts `giveaways.default.*`, in the server's language;
// their {gw.*} and {user} variables are filled by the template engine.
const refreshQueues = new Map();

/**
 * Runs `work(lang)` in the language of a server. The engine is called from commands, but also from the giveaway job and the
 * dashboard, which run outside of any server: everything it posts in Discord is in the server's language.
 */
async function inServerLanguage(guildId, work) {
  const lang = await guildLanguage(guildId);
  return runWithLanguage(lang, () => work(lang));
}

/**
 * What a preset asks and gives: its roles (the array), and on the array too `levels` (extra entries from some levels), `minLevel` and
 * `minVoiceLevel` (the levels needed to enter). They are properties of the array so everything that already takes the roles keeps working.
 */
async function loadPreset(presetId) {
  if (!presetId) return Object.assign([], { levels: [], minLevel: 0, minVoiceLevel: 0 });
  const [roles, levels, preset] = await Promise.all([presetsDb.listRoles(presetId), presetsDb.listLevels(presetId), presetsDb.getPresetById(presetId)]);
  return Object.assign([...roles], { levels, minLevel: Number(preset?.min_level ?? 0), minVoiceLevel: Number(preset?.min_voice_level ?? 0) });
}

/** Extra entries a member earns from their levels: for each kind of level (messages, voice) the best step they have reached. */
function computeLevelBonus(levelRow, levels) {
  if (!levels?.length || !levelRow) return 0;
  let total = 0;
  for (const source of ['text', 'voice']) {
    const reached = source === 'voice' ? Number(levelRow.voice_level ?? 0) : Number(levelRow.level ?? 0);
    const steps = levels.filter((step) => step.source === source && Number(step.level) <= reached);
    if (steps.length) total += Number(steps.reduce((best, step) => (Number(step.level) > Number(best.level) ? step : best)).entries);
  }
  return total;
}

/** Why a member cannot enter a giveaway of a preset (a text for them), or null when they can. */
async function entryProblem(guildId, preset, userId, lang = currentLanguage()) {
  if (!preset?.minLevel && !preset?.minVoiceLevel) return null;
  const row = (await levelUsersDb.getUsers(guildId, [userId])).get(userId);
  const text = Number(row?.level ?? 0);
  const voice = Number(row?.voice_level ?? 0);
  const needsText = preset.minLevel > text;
  const needsVoice = preset.minVoiceLevel > voice;
  if (needsText && needsVoice) return t(lang, 'giveaways.entry.needBoth', { level: preset.minLevel, current: text, voiceLevel: preset.minVoiceLevel, voiceCurrent: voice });
  if (needsText) return t(lang, 'giveaways.entry.needMessage', { level: preset.minLevel, current: text });
  if (needsVoice) return t(lang, 'giveaways.entry.needVoice', { level: preset.minVoiceLevel, current: voice });
  return null;
}

/** Bonus entries / claim time a member earns from a preset's roles. Stacking roles sum; non-stacking roles contribute only their single best value. */
function computePresetBonus(member, presetRoles) {
  if (!member || !presetRoles?.length) return { entries: 0, claimTimeMs: 0 };
  const matched = presetRoles.filter((r) => member.roles.cache.has(r.role_id));
  if (!matched.length) return { entries: 0, claimTimeMs: 0 };

  const stackEntries = matched.filter((r) => r.entries_stack).reduce((s, r) => s + r.entries, 0);
  const bestNonStackEntries = Math.max(0, ...matched.filter((r) => !r.entries_stack).map((r) => r.entries));
  const stackClaim = matched.filter((r) => r.claim_time_stack).reduce((s, r) => s + r.claim_time_ms, 0);
  const bestNonStackClaim = Math.max(0, ...matched.filter((r) => !r.claim_time_stack).map((r) => r.claim_time_ms));

  return { entries: stackEntries + bestNonStackEntries, claimTimeMs: stackClaim + bestNonStackClaim };
}

/** Pre-joined text for the {gw.preset} variable — the templating engine has no real loop syntax, so this is built once here. */
function buildPresetText(presetRoles, lang = currentLanguage()) {
  const lines = (presetRoles ?? []).map((r) => (r.claim_time_ms
    ? tn(lang, 'giveaways.preset.text.roleClaim', r.entries, { count: r.entries, role: `<@&${r.role_id}>`, duration: formatDuration(r.claim_time_ms, lang) })
    : tn(lang, 'giveaways.preset.text.role', r.entries, { count: r.entries, role: `<@&${r.role_id}>` })));
  if (presetRoles?.minLevel) lines.push(t(lang, 'giveaways.preset.text.minLevel', { level: presetRoles.minLevel }));
  if (presetRoles?.minVoiceLevel) lines.push(t(lang, 'giveaways.preset.text.minVoiceLevel', { level: presetRoles.minVoiceLevel }));
  for (const step of presetRoles?.levels ?? []) {
    const vars = { count: step.entries, level: step.level };
    lines.push(step.source === 'voice' ? tn(lang, 'giveaways.preset.text.voiceLevel', step.entries, vars) : tn(lang, 'giveaways.preset.text.level', step.entries, vars));
  }
  return lines.join('\n');
}

function weightedDraw(pool, count) {
  const items = pool.map((i) => ({ ...i }));
  const winners = [];
  while (items.length && winners.length < count) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < items.length - 1; idx++) {
      r -= items[idx].weight;
      if (r <= 0) break;
    }
    winners.push(items.splice(idx, 1)[0].userId);
  }
  return winners;
}

/** Builds the weighted entry pool for a giveaway, fetching members only if a preset is attached (flat weight-1 otherwise). */
async function buildEntryPool(guild, entries, presetRoles) {
  const levels = presetRoles?.levels ?? [];
  if (!presetRoles?.length && !levels.length) return entries.map((e) => ({ userId: e.user_id, weight: 1 }));

  const levelRows = levels.length ? await levelUsersDb.getUsers(guild.id, entries.map((e) => e.user_id)).catch(() => new Map()) : new Map();
  const pool = [];
  for (const entry of entries) {
    const member = guild.members.cache.get(entry.user_id) ?? (await guild.members.fetch(entry.user_id).catch(() => null));
    if (!member) continue;
    const bonus = computePresetBonus(member, presetRoles);
    pool.push({ userId: entry.user_id, weight: 1 + bonus.entries + computeLevelBonus(levelRows.get(entry.user_id), levels) });
  }
  return pool;
}

function giveawayCtx(giveaway, presetText, extra = {}, lang = currentLanguage()) {
  const guild = extra.ctx?.guild;
  const hostUser = guild?.members?.cache?.get(giveaway.host_id)?.user
    ?? guild?.client?.users?.cache?.get(giveaway.host_id)
    ?? null;
  const endsAtUnix = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
  const ended = Boolean(giveaway.ended);
  const entryText = ended
    ? t(lang, 'giveaways.vars.ended')
    : giveaway.entry_mode === 'reaction'
      ? t(lang, 'giveaways.vars.react', { reaction: giveaway.reaction })
      : t(lang, 'giveaways.vars.click');

  return {
    giveaway: {
      prize: giveaway.prize,
      winnersCount: giveaway.winners_count,
      entriesCount: extra.entriesCount ?? 0,
      hostId: giveaway.host_id,
      hostName: hostUser?.username ?? '',
      hostAvatar: hostUser?.displayAvatarURL?.({ size: 512 }) ?? '',
      endsAtUnix,
      claimTimeText: extra.claimTimeMs ? formatDuration(extra.claimTimeMs, lang) : '',
      reaction: giveaway.reaction,
      entryMode: giveaway.entry_mode,
      entryText,
      winnerText: tn(lang, 'giveaways.card.luckyWinners', giveaway.winners_count, { count: giveaway.winners_count }),
      status: ended ? t(lang, 'giveaways.vars.statusEnded') : t(lang, 'giveaways.vars.statusActive'),
      presetText,
    },
    ...extra.ctx,
  };
}

/** If the giveaway (or its guild default) has a saved embed template, resolves it against giveaway ctx. Returns null otherwise. */
async function resolveCustomEmbed(guild, channel, giveaway, presetText, entriesCount = 0, lang = currentLanguage()) {
  if (!giveaway.embed_template) return null;
  const embedTemplatesDb = require('../db/embedTemplates');
  const doc = await embedTemplatesDb.getTemplate(giveaway.guild_id, giveaway.embed_template);
  if (!doc) return null;
  const { build } = require('./embedBuilder');
  const ctx = giveawayCtx(giveaway, presetText, { entriesCount, ctx: { guild, channel } }, lang);
  return build(doc.data, ctx);
}

function hostPresentation(guild, hostId) {
  const user = guild?.members?.cache?.get(hostId)?.user
    ?? guild?.client?.users?.cache?.get(hostId)
    ?? null;
  return {
    hostName: user?.username ?? 'Giveaway host', // i18n-ignore: only tells the card to show a timestamp, never shown
    hostAvatar: user?.displayAvatarURL?.({ size: 512 }) ?? null,
  };
}

/** Posts (or re-posts, for edit) the live giveaway message. Uses a saved embed template if the giveaway has one, otherwise Petto's built-in Discord embed. */
async function postGiveawayMessage(channel, giveaway, entriesCount, presetText = '', lang = currentLanguage()) {
  const customPayload = await resolveCustomEmbed(channel.guild, channel, giveaway, presetText, entriesCount, lang);
  const enterRow = giveaway.entry_mode === 'button' ? buildEnterRow(giveaway.id, { lang }) : null;

  let message;
  if (customPayload) {
    const templateRows = (customPayload.components ?? []).slice(0, enterRow ? 4 : 5);
    const components = [...templateRows, ...(enterRow ? [enterRow] : [])];
    message = await channel.send({ content: customPayload.content, embeds: customPayload.embeds, components, files: customPayload.files });
  } else {
    const card = buildEntryCard({
      prize: giveaway.prize,
      hostId: giveaway.host_id,
      winnersCount: giveaway.winners_count,
      endsAtUnix: Math.floor(new Date(giveaway.ends_at).getTime() / 1000),
      entryMode: giveaway.entry_mode,
      reaction: giveaway.reaction,
      entriesCount,
      ended: false,
      presetText,
      ...hostPresentation(channel.guild, giveaway.host_id),
      lang,
    });
    message = await channel.send({ embeds: [card], components: enterRow ? [enterRow] : [] });
  }

  if (giveaway.entry_mode === 'reaction') await message.react(giveaway.reaction).catch(() => {});
  return message;
}

/** Re-renders a still-active giveaway's message in place (used by `giveaway edit`). */
async function refreshGiveawayMessageNow(channel, giveaway, lang) {
  const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  if (!message) return;

  const presetRoles = giveaway.preset_id ? await loadPreset(giveaway.preset_id) : [];
  const presetText = buildPresetText(presetRoles, lang);
  const entriesCount = await giveawaysDb.countEntries(giveaway.id);
  const customPayload = await resolveCustomEmbed(channel.guild, channel, giveaway, presetText, entriesCount, lang);
  const enterRow = giveaway.entry_mode === 'button' ? buildEnterRow(giveaway.id, { lang }) : null;

  if (customPayload) {
    const templateRows = (customPayload.components ?? []).slice(0, enterRow ? 4 : 5);
    const components = [...templateRows, ...(enterRow ? [enterRow] : [])];
    await message.edit({ content: customPayload.content, embeds: customPayload.embeds, components, files: customPayload.files ?? [], attachments: [] }).catch(() => {});
    return;
  }

  const card = buildEntryCard({
    prize: giveaway.prize,
    hostId: giveaway.host_id,
    winnersCount: giveaway.winners_count,
    endsAtUnix: Math.floor(new Date(giveaway.ends_at).getTime() / 1000),
    entryMode: giveaway.entry_mode,
    reaction: giveaway.reaction,
    entriesCount,
    ended: false,
    presetText,
    ...hostPresentation(channel.guild, giveaway.host_id),
    lang,
  });
  await message.edit({ content: null, embeds: [card], components: enterRow ? [enterRow] : [] }).catch(() => {});
}

/** Serializes edits for the same giveaway so concurrent entries cannot overwrite a newer count. */
async function refreshGiveawayMessage(channel, giveaway) {
  const key = `${channel.guild.id}:${giveaway.id}`;
  const previous = refreshQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => inServerLanguage(channel.guild.id, (lang) => refreshGiveawayMessageNow(channel, giveaway, lang)))
    .finally(() => {
      if (refreshQueues.get(key) === current) refreshQueues.delete(key);
    });
  refreshQueues.set(key, current);
  return current;
}

/** Creates a giveaway row, posts its message, and stores the message id. */
async function startGiveaway({ guild, channel, hostId, prize, winnersCount, endsAt, claimTimeMs, entryMode, reaction, presetId, embedTemplate }) {
  const giveaway = await giveawaysDb.createGiveaway({
    guild_id: guild.id,
    channel_id: channel.id,
    host_id: hostId,
    prize,
    winners_count: winnersCount,
    ends_at: endsAt.toISOString(),
    claim_time_ms: claimTimeMs ?? null,
    entry_mode: entryMode,
    reaction,
    preset_id: presetId ?? null,
    embed_template: embedTemplate ?? null,
  });

  const presetRoles = presetId ? await loadPreset(presetId) : [];
  const message = await inServerLanguage(guild.id, (lang) => postGiveawayMessage(channel, giveaway, 0, buildPresetText(presetRoles, lang), lang));
  await giveawaysDb.setMessageId(giveaway.id, message.id);
  return { ...giveaway, message_id: message.id };
}

async function editEndedMessage(channel, giveaway, winnerIds, presetText = '', entriesCount = 0, lang = currentLanguage()) {
  const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  if (!message) return;

  const summaryText = winnerIds.length
    ? tn(lang, 'giveaways.result.winners', winnerIds.length, { emoji: EMOJI.APPROVE, winners: winnerIds.map((id) => `<@${id}>`).join(', ') })
    : t(lang, 'giveaways.result.none', { emoji: EMOJI.DENY });

  const endedGiveaway = { ...giveaway, ended: true };
  const customEmbed = await resolveCustomEmbed(channel.guild, channel, endedGiveaway, presetText, entriesCount, lang);
  if (customEmbed) {
    const content = [customEmbed.content, summaryText].filter(Boolean).join('\n');
    await message.edit({
      content: content || null,
      embeds: customEmbed.embeds,
      components: [],
      files: customEmbed.files ?? [],
      attachments: [],
    }).catch(() => {});
    return;
  }

  const card = buildEntryCard({
    prize: giveaway.prize,
    hostId: giveaway.host_id,
    winnersCount: giveaway.winners_count,
    endsAtUnix: Math.floor(new Date(giveaway.ends_at).getTime() / 1000),
    entryMode: giveaway.entry_mode,
    reaction: giveaway.reaction,
    entriesCount,
    ended: true,
    presetText,
    ...hostPresentation(channel.guild, giveaway.host_id),
    lang,
  });
  await message.edit({ content: summaryText, embeds: [card], components: [] }).catch(() => {});
}

/** Draws one replacement winner from the pool, excluding everyone already a winner. Used both for the initial draw and for deny/expiry redraws. */
async function drawOne(guild, giveaway, presetRoles, excludeUserIds) {
  const entries = await giveawaysDb.listEntries(giveaway.id);
  const remaining = entries.filter((e) => !excludeUserIds.includes(e.user_id));
  if (!remaining.length) return null;
  const pool = await buildEntryPool(guild, remaining, presetRoles);
  const [winnerId] = weightedDraw(pool, 1);
  return winnerId ?? null;
}

async function claimTimeForWinner(guild, presetRoles, giveaway, userId) {
  if (!presetRoles?.length) return giveaway.claim_time_ms || null;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  if (!member) return giveaway.claim_time_ms || null;
  const bonus = computePresetBonus(member, presetRoles);
  return bonus.claimTimeMs || giveaway.claim_time_ms || null;
}

/** Announces a freshly-drawn winner: either an immediate congrats (no claim time) or a claim prompt with Accept/Deny buttons. */
async function announceWinner(channel, config, giveaway, presetText, winnerId, claimTimeMs, lang = currentLanguage()) {
  const member = await channel.guild.members.fetch(winnerId).catch(() => null);
  const ctx = giveawayCtx(giveaway, presetText, { claimTimeMs, ctx: { guild: channel.guild, channel, member, user: member?.user } }, lang);

  if (claimTimeMs) {
    const winnerRow = await giveawaysDb.addWinner(giveaway.id, winnerId, new Date(Date.now() + claimTimeMs).toISOString());
    const text = config.claim_time_message ? null : t(lang, 'giveaways.default.claim');
    await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.claim_time_message, embedTemplateName: config.claim_time_embed_template, ctx, fallback: text });
    await sendAs(channel, 'giveaways', { content: `<@${winnerId}>`, components: [buildClaimRow(winnerRow.id, lang)] }).catch(() => {});
    return winnerRow;
  }

  const winnerRow = await giveawaysDb.addWinner(giveaway.id, winnerId, null);
  await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.winner_message, embedTemplateName: config.winner_embed_template, ctx, fallback: t(lang, 'giveaways.default.winner') });
  return winnerRow;
}

/** Ends a giveaway: marks it ended, edits the message, draws winners_count winners (weighted by preset), and announces each. */
async function endGiveaway(client, giveaway) {
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  if (!guild) {
    await giveawaysDb.markEnded(giveaway.id);
    return;
  }
  await inServerLanguage(giveaway.guild_id, async (lang) => {
    const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
    const configDb = require('../db/giveawayConfig');
    const config = await configDb.ensureConfig(giveaway.guild_id);

    const presetRoles = giveaway.preset_id ? await loadPreset(giveaway.preset_id) : [];
    const presetText = buildPresetText(presetRoles, lang);

    await giveawaysDb.markEnded(giveaway.id);

    const entries = await giveawaysDb.listEntries(giveaway.id);
    if (!entries.length) {
      if (channel) {
        const ctx = giveawayCtx(giveaway, presetText, { ctx: { guild, channel } }, lang);
        await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.no_entries_message, embedTemplateName: config.no_entries_embed_template, ctx, fallback: t(lang, 'giveaways.default.noEntries') });
        await editEndedMessage(channel, giveaway, [], presetText, entries.length, lang);
      }
      return;
    }

    const pool = await buildEntryPool(guild, entries, presetRoles);
    const winnerIds = weightedDraw(pool, giveaway.winners_count);

    if (channel) {
      for (const winnerId of winnerIds) {
        const claimTimeMs = await claimTimeForWinner(guild, presetRoles, giveaway, winnerId);
        await announceWinner(channel, config, giveaway, presetText, winnerId, claimTimeMs, lang).catch((err) => logger.error(`Failed to announce giveaway winner ${winnerId}:`, err));
      }
      await editEndedMessage(channel, giveaway, winnerIds, presetText, entries.length, lang);
    }
  });
}

/** Handles a denied or expired claim: marks the status, announces it, and draws+announces a replacement winner if entries remain. */
async function handleForfeit(client, winnerRow, status) {
  const giveaway = await giveawaysDb.getGiveaway(winnerRow.giveaway_id);
  if (!giveaway) return;
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(giveaway.channel_id).catch(() => null) : null;
  if (!guild || !channel) return;

  await inServerLanguage(giveaway.guild_id, async (lang) => {
    const configDb = require('../db/giveawayConfig');
    const config = await configDb.ensureConfig(giveaway.guild_id);
    const presetRoles = giveaway.preset_id ? await loadPreset(giveaway.preset_id) : [];
    const presetText = buildPresetText(presetRoles, lang);

    await giveawaysDb.setWinnerStatus(winnerRow.id, status);

    const member = await guild.members.fetch(winnerRow.user_id).catch(() => null);
    const ctx = giveawayCtx(giveaway, presetText, { ctx: { guild, channel, member, user: member?.user } }, lang);
    const forfeitMessage = status === 'denied' ? config.deny_message : config.claim_time_over_message;
    const forfeitFallback = status === 'denied' ? t(lang, 'giveaways.default.deny') : t(lang, 'giveaways.default.claimOver');
    await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: forfeitMessage, embedTemplateName: status === 'denied' ? config.deny_embed_template : config.claim_time_over_embed_template, ctx, fallback: forfeitFallback });

    const allWinners = await giveawaysDb.listWinners(giveaway.id);
    const excludeIds = allWinners.map((w) => w.user_id);
    const replacementId = await drawOne(guild, giveaway, presetRoles, excludeIds);
    if (!replacementId) return;

    const claimTimeMs = await claimTimeForWinner(guild, presetRoles, giveaway, replacementId);
    await announceWinner(channel, config, giveaway, presetText, replacementId, claimTimeMs, lang);
  });
}

async function handleAccept(client, winnerRow) {
  const giveaway = await giveawaysDb.getGiveaway(winnerRow.giveaway_id);
  if (!giveaway) return;
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(giveaway.channel_id).catch(() => null) : null;
  if (!guild || !channel) return;

  await inServerLanguage(giveaway.guild_id, async (lang) => {
    const configDb = require('../db/giveawayConfig');
    const config = await configDb.ensureConfig(giveaway.guild_id);
    const presetRoles = giveaway.preset_id ? await loadPreset(giveaway.preset_id) : [];
    const presetText = buildPresetText(presetRoles, lang);

    await giveawaysDb.setWinnerStatus(winnerRow.id, 'claimed');
    const member = await guild.members.fetch(winnerRow.user_id).catch(() => null);
    const ctx = giveawayCtx(giveaway, presetText, { ctx: { guild, channel, member, user: member?.user } }, lang);
    await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.accept_message, embedTemplateName: config.accept_embed_template, ctx, fallback: t(lang, 'giveaways.default.accept') });
  });
}

/**
 * Reroll — draws a fresh set of winners for an already-ended giveaway. Appends new giveaway_winners rows rather than deleting prior ones.
 * `lang` is the language of the errors (for whoever asked); the announcements are in the server's language.
 */
async function rerollGiveaway(client, giveaway, winnersCount, lang = currentLanguage()) {
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  if (!guild) throw Object.assign(new Error(t(lang, 'giveaways.reroll.noServer')), { userFacing: true });
  const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) throw Object.assign(new Error(t(lang, 'giveaways.reroll.noChannel')), { userFacing: true });

  const configDb = require('../db/giveawayConfig');
  const config = await configDb.ensureConfig(giveaway.guild_id);
  const presetRoles = giveaway.preset_id ? await loadPreset(giveaway.preset_id) : [];

  const entries = await giveawaysDb.listEntries(giveaway.id);
  if (!entries.length) throw Object.assign(new Error(t(lang, 'giveaways.reroll.noEntries')), { userFacing: true });

  const pool = await buildEntryPool(guild, entries, presetRoles);
  const winnerIds = weightedDraw(pool, winnersCount ?? giveaway.winners_count);
  if (!winnerIds.length) throw Object.assign(new Error(t(lang, 'giveaways.reroll.noWinners')), { userFacing: true });

  await inServerLanguage(giveaway.guild_id, async (serverLang) => {
    const presetText = buildPresetText(presetRoles, serverLang);
    for (const winnerId of winnerIds) {
      const claimTimeMs = await claimTimeForWinner(guild, presetRoles, giveaway, winnerId);
      await announceWinner(channel, config, giveaway, presetText, winnerId, claimTimeMs, serverLang).catch((err) => logger.error(`Failed to announce reroll winner ${winnerId}:`, err));
    }
  });
  return winnerIds;
}

module.exports = {
  loadPreset,
  computeLevelBonus,
  entryProblem,
  computePresetBonus,
  buildPresetText,
  weightedDraw,
  startGiveaway,
  postGiveawayMessage,
  refreshGiveawayMessage,
  endGiveaway,
  handleForfeit,
  handleAccept,
  rerollGiveaway,
  giveawayCtx,
};

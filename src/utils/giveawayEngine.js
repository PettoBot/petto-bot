const { MessageFlags } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const presetsDb = require('../db/giveawayPresets');
const { formatDuration } = require('./duration');
const { buildEntryCard, buildEnterRow, buildClaimRow, sendGiveawayResponse, GIVEAWAY_COLOR } = require('./giveawayCard');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const DEFAULT_WINNER_TEXT = '{gw.host}\'s giveaway for **{gw.prize}** is over — congratulations {user}! 🎉';
const DEFAULT_CLAIM_TEXT = 'You won **{gw.prize}**! Click **Accept** below within {gw.claim_time} to claim it.';
const DEFAULT_DENY_TEXT = '{user} denied their win for **{gw.prize}**. Redrawing a new winner...';
const DEFAULT_CLAIM_OVER_TEXT = '{user} did not claim **{gw.prize}** in time. Redrawing a new winner...';
const DEFAULT_ACCEPT_TEXT = '{user} accepted their win for **{gw.prize}**! 🎉';
const DEFAULT_NO_ENTRIES_TEXT = 'The giveaway for **{gw.prize}** ended with no valid entries.';
const refreshQueues = new Map();

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
function buildPresetText(presetRoles) {
  if (!presetRoles?.length) return '';
  return presetRoles
    .map((r) => `<@&${r.role_id}> — +${r.entries} entries${r.claim_time_ms ? ` · ${formatDuration(r.claim_time_ms)} to claim` : ''}`)
    .join('\n');
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
  if (!presetRoles?.length) return entries.map((e) => ({ userId: e.user_id, weight: 1 }));

  const pool = [];
  for (const entry of entries) {
    const member = guild.members.cache.get(entry.user_id) ?? (await guild.members.fetch(entry.user_id).catch(() => null));
    if (!member) continue;
    const bonus = computePresetBonus(member, presetRoles);
    pool.push({ userId: entry.user_id, weight: 1 + bonus.entries });
  }
  return pool;
}

function giveawayCtx(giveaway, presetText, extra = {}) {
  return {
    giveaway: {
      prize: giveaway.prize,
      winnersCount: giveaway.winners_count,
      entriesCount: extra.entriesCount ?? 0,
      hostId: giveaway.host_id,
      endsAtUnix: Math.floor(new Date(giveaway.ends_at).getTime() / 1000),
      claimTimeText: extra.claimTimeMs ? formatDuration(extra.claimTimeMs) : '',
      reaction: giveaway.reaction,
      entryMode: giveaway.entry_mode,
      presetText,
    },
    ...extra.ctx,
  };
}

/** If the giveaway (or its guild default) has a saved embed template, resolves it against giveaway ctx. Returns null otherwise. */
async function resolveCustomEmbed(guild, channel, giveaway, presetText, entriesCount = 0) {
  if (!giveaway.embed_template) return null;
  const templatesDb = require('../db/giveawayTemplates');
  const doc = await templatesDb.getTemplate(giveaway.guild_id, giveaway.embed_template);
  if (!doc) return null;
  const { build } = require('./embedBuilder');
  const ctx = giveawayCtx(giveaway, presetText, { entriesCount, ctx: { guild, channel } });
  return build(doc.data, ctx);
}

/** Posts (or re-posts, for edit) the live giveaway message. Uses a saved embed template if the giveaway has one, otherwise a default Components V2 card. */
async function postGiveawayMessage(channel, giveaway, entriesCount, presetText = '') {
  const customPayload = await resolveCustomEmbed(channel.guild, channel, giveaway, presetText, entriesCount);
  const enterRow = giveaway.entry_mode === 'button' ? buildEnterRow(giveaway.id) : null;

  let message;
  if (customPayload) {
    const components = [...(customPayload.components ?? []), ...(enterRow ? [enterRow] : [])];
    message = await channel.send({ content: customPayload.content, embeds: customPayload.embeds, components });
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
    });
    const components = enterRow ? [card, enterRow] : [card];
    message = await channel.send({ components, flags: MessageFlags.IsComponentsV2 });
  }

  if (giveaway.entry_mode === 'reaction') await message.react(giveaway.reaction).catch(() => {});
  return message;
}

/** Re-renders a still-active giveaway's message in place (used by `giveaway edit`). */
async function refreshGiveawayMessageNow(channel, giveaway) {
  const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  if (!message) return;

  const presetRoles = giveaway.preset_id ? await presetsDb.listRoles(giveaway.preset_id) : [];
  const presetText = buildPresetText(presetRoles);
  const entriesCount = await giveawaysDb.countEntries(giveaway.id);
  const customPayload = await resolveCustomEmbed(channel.guild, channel, giveaway, presetText, entriesCount);
  const enterRow = giveaway.entry_mode === 'button' ? buildEnterRow(giveaway.id) : null;

  if (customPayload) {
    const components = [...(customPayload.components ?? []), ...(enterRow ? [enterRow] : [])];
    await message.edit({ content: customPayload.content, embeds: customPayload.embeds, components }).catch(() => {});
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
  });
  await message.edit({ components: enterRow ? [card, enterRow] : [card], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

/** Serializes edits for the same giveaway so concurrent entries cannot overwrite a newer count. */
async function refreshGiveawayMessage(channel, giveaway) {
  const key = `${channel.guild.id}:${giveaway.id}`;
  const previous = refreshQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => refreshGiveawayMessageNow(channel, giveaway))
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

  const presetRoles = presetId ? await presetsDb.listRoles(presetId) : [];
  const message = await postGiveawayMessage(channel, giveaway, 0, buildPresetText(presetRoles));
  await giveawaysDb.setMessageId(giveaway.id, message.id);
  return { ...giveaway, message_id: message.id };
}

async function editEndedMessage(channel, giveaway, winnerIds, presetText = '', entriesCount = 0) {
  const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  if (!message) return;

  const summaryText = winnerIds.length ? `${EMOJI.APPROVE}  Winner(s): ${winnerIds.map((id) => `<@${id}>`).join(', ')}` : `${EMOJI.DENY}  No valid entries.`;

  const customEmbed = await resolveCustomEmbed(channel.guild, channel, giveaway, presetText, entriesCount);
  if (customEmbed) {
    await message.edit({ embeds: [customEmbed.setFooter({ text: summaryText })], components: [] }).catch(() => {});
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
  });
  const summary = textCard(summaryText, GIVEAWAY_COLOR);
  await message.edit({ components: [card, summary], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
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
async function announceWinner(channel, config, giveaway, presetText, winnerId, claimTimeMs) {
  const member = await channel.guild.members.fetch(winnerId).catch(() => null);
  const ctx = giveawayCtx(giveaway, presetText, { claimTimeMs, ctx: { guild: channel.guild, channel, member, user: member?.user } });

  if (claimTimeMs) {
    const winnerRow = await giveawaysDb.addWinner(giveaway.id, winnerId, new Date(Date.now() + claimTimeMs).toISOString());
    const text = config.claim_time_message ? null : DEFAULT_CLAIM_TEXT;
    await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.claim_time_message, embedTemplateName: null, ctx, fallback: text });
    await channel.send({ content: `<@${winnerId}>`, components: [buildClaimRow(winnerRow.id)] }).catch(() => {});
    return winnerRow;
  }

  const winnerRow = await giveawaysDb.addWinner(giveaway.id, winnerId, null);
  await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.winner_message, embedTemplateName: null, ctx, fallback: DEFAULT_WINNER_TEXT });
  return winnerRow;
}

/** Ends a giveaway: marks it ended, edits the message, draws winners_count winners (weighted by preset), and announces each. */
async function endGiveaway(client, giveaway) {
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  if (!guild) {
    await giveawaysDb.markEnded(giveaway.id);
    return;
  }
  const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
  const configDb = require('../db/giveawayConfig');
  const config = await configDb.ensureConfig(giveaway.guild_id);

  const presetRoles = giveaway.preset_id ? await presetsDb.listRoles(giveaway.preset_id) : [];
  const presetText = buildPresetText(presetRoles);

  await giveawaysDb.markEnded(giveaway.id);

  const entries = await giveawaysDb.listEntries(giveaway.id);
  if (!entries.length) {
    if (channel) {
      const ctx = giveawayCtx(giveaway, presetText, { ctx: { guild, channel } });
      await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.no_entries_message, embedTemplateName: null, ctx, fallback: DEFAULT_NO_ENTRIES_TEXT });
      await editEndedMessage(channel, giveaway, [], presetText, entries.length);
    }
    return;
  }

  const pool = await buildEntryPool(guild, entries, presetRoles);
  const winnerIds = weightedDraw(pool, giveaway.winners_count);

  if (channel) {
    for (const winnerId of winnerIds) {
      const claimTimeMs = await claimTimeForWinner(guild, presetRoles, giveaway, winnerId);
      await announceWinner(channel, config, giveaway, presetText, winnerId, claimTimeMs).catch((err) => logger.error(`Failed to announce giveaway winner ${winnerId}:`, err));
    }
    await editEndedMessage(channel, giveaway, winnerIds, presetText, entries.length);
  }
}

/** Handles a denied or expired claim: marks the status, announces it, and draws+announces a replacement winner if entries remain. */
async function handleForfeit(client, winnerRow, status) {
  const giveaway = await giveawaysDb.getGiveaway(winnerRow.giveaway_id);
  if (!giveaway) return;
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(giveaway.channel_id).catch(() => null) : null;
  if (!guild || !channel) return;

  const configDb = require('../db/giveawayConfig');
  const config = await configDb.ensureConfig(giveaway.guild_id);
  const presetRoles = giveaway.preset_id ? await presetsDb.listRoles(giveaway.preset_id) : [];
  const presetText = buildPresetText(presetRoles);

  await giveawaysDb.setWinnerStatus(winnerRow.id, status);

  const member = await guild.members.fetch(winnerRow.user_id).catch(() => null);
  const ctx = giveawayCtx(giveaway, presetText, { ctx: { guild, channel, member, user: member?.user } });
  const forfeitMessage = status === 'denied' ? config.deny_message : config.claim_time_over_message;
  const forfeitFallback = status === 'denied' ? DEFAULT_DENY_TEXT : DEFAULT_CLAIM_OVER_TEXT;
  await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: forfeitMessage, embedTemplateName: null, ctx, fallback: forfeitFallback });

  const allWinners = await giveawaysDb.listWinners(giveaway.id);
  const excludeIds = allWinners.map((w) => w.user_id);
  const replacementId = await drawOne(guild, giveaway, presetRoles, excludeIds);
  if (!replacementId) return;

  const claimTimeMs = await claimTimeForWinner(guild, presetRoles, giveaway, replacementId);
  await announceWinner(channel, config, giveaway, presetText, replacementId, claimTimeMs);
}

async function handleAccept(client, winnerRow) {
  const giveaway = await giveawaysDb.getGiveaway(winnerRow.giveaway_id);
  if (!giveaway) return;
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(giveaway.channel_id).catch(() => null) : null;
  if (!guild || !channel) return;

  const configDb = require('../db/giveawayConfig');
  const config = await configDb.ensureConfig(giveaway.guild_id);
  const presetRoles = giveaway.preset_id ? await presetsDb.listRoles(giveaway.preset_id) : [];
  const presetText = buildPresetText(presetRoles);

  await giveawaysDb.setWinnerStatus(winnerRow.id, 'claimed');
  const member = await guild.members.fetch(winnerRow.user_id).catch(() => null);
  const ctx = giveawayCtx(giveaway, presetText, { ctx: { guild, channel, member, user: member?.user } });
  await sendGiveawayResponse({ target: channel, guildId: giveaway.guild_id, messageText: config.accept_message, embedTemplateName: null, ctx, fallback: DEFAULT_ACCEPT_TEXT });
}

/** Reroll — draws a fresh set of winners for an already-ended giveaway. Appends new giveaway_winners rows rather than deleting prior ones. */
async function rerollGiveaway(client, giveaway, winnersCount) {
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  if (!guild) throw Object.assign(new Error("Couldn't fetch that giveaway's server."), { userFacing: true });
  const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) throw Object.assign(new Error("That giveaway's channel no longer exists."), { userFacing: true });

  const configDb = require('../db/giveawayConfig');
  const config = await configDb.ensureConfig(giveaway.guild_id);
  const presetRoles = giveaway.preset_id ? await presetsDb.listRoles(giveaway.preset_id) : [];
  const presetText = buildPresetText(presetRoles);

  const entries = await giveawaysDb.listEntries(giveaway.id);
  if (!entries.length) throw Object.assign(new Error('That giveaway has no entries to reroll from.'), { userFacing: true });

  const pool = await buildEntryPool(guild, entries, presetRoles);
  const winnerIds = weightedDraw(pool, winnersCount ?? giveaway.winners_count);
  if (!winnerIds.length) throw Object.assign(new Error('No eligible winners could be drawn.'), { userFacing: true });

  for (const winnerId of winnerIds) {
    const claimTimeMs = await claimTimeForWinner(guild, presetRoles, giveaway, winnerId);
    await announceWinner(channel, config, giveaway, presetText, winnerId, claimTimeMs).catch((err) => logger.error(`Failed to announce reroll winner ${winnerId}:`, err));
  }
  return winnerIds;
}

module.exports = {
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

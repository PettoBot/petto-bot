// i18n-ignore-file: Premium list for the Petto team channel.
// When Petto starts it lists the Premium that is active in the channel of the team (PETTO_PREMIUM_LOG_CHANNEL_ID), so the team can see
// that the subscriptions that Polar reported reached the database. It does nothing when the channel is not set. A restart that finds the
// same list already posted adds nothing; when the list changed it posts the new one and removes the old one, so the channel never piles up.
const { MessageFlags } = require('discord.js');
const config = require('../config');
const { listActiveEntitlements } = require('../db/premium');
const { textCard } = require('../utils/caseCard');
const logger = require('../utils/logger');

const START_DELAY_MS = 45_000;
const MAX_TEXT = 3400;
const PEACH = 0xf0a88f;

function lineFor(entitlement) {
  const until = entitlement.current_period_end ? ` · until <t:${Math.floor(Date.parse(entitlement.current_period_end) / 1000)}:d>` : ' · no end date';
  const source = entitlement.provider === 'polar' ? 'Polar' : (entitlement.provider || 'manual');
  return `<@${entitlement.user_id}> · ${entitlement.plan_key || 'premium'} · ${entitlement.slot_limit ?? 1} slot(s)${until} · ${source}`;
}

/** The cards to post: the list split in parts that fit in a message. */
function buildPremiumCards(entitlements) {
  const header = `### Premium active at start\n**${entitlements.length}** active subscription${entitlements.length === 1 ? '' : 's'}.`;
  if (!entitlements.length) return [textCard(`${header}\nNone right now.`, PEACH)];
  const parts = [];
  let current = [];
  let size = header.length;
  for (const entitlement of entitlements) {
    const line = lineFor(entitlement);
    if (size + line.length > MAX_TEXT && current.length) { parts.push(current); current = []; size = 0; }
    current.push(line); size += line.length + 1;
  }
  parts.push(current);
  return parts.map((lines, index) => textCard(`${index === 0 ? `${header}\n` : ''}${lines.join('\n')}`, PEACH));
}

const HEADER = '### Premium active at start';

/** Every piece of text in a card or message (a Components V2 tree), in order. */
function textOf(node) {
  const data = typeof node?.toJSON === 'function' ? node.toJSON() : node;
  if (!data || typeof data !== 'object') return '';
  const own = typeof data.content === 'string' ? data.content : '';
  const inner = Array.isArray(data.components) ? data.components.map(textOf) : [];
  return [own, ...inner].filter(Boolean).join('\n');
}

/** The list this bot posted last time: its first message and the ones that continue it. Empty when there is none or it cannot be read. */
async function lastPosted(channel, botId) {
  const fetched = await channel.messages?.fetch?.({ limit: 30 }).catch(() => null);
  if (!fetched) return [];
  const mine = [...fetched.values()].filter((message) => message.author?.id === botId).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const body = (message) => textOf({ components: message.components });
  let start = -1;
  mine.forEach((message, index) => { if (body(message).startsWith(HEADER)) start = index; });
  if (start < 0) return [];
  const group = [mine[start]];
  for (const message of mine.slice(start + 1)) {
    const text = body(message);
    if (text.startsWith(HEADER) || !(text.startsWith('<@') || text.startsWith('None right now'))) break;
    group.push(message);
  }
  return group;
}

async function announceActivePremium(client) {
  if (!config.premiumLogChannelId) return false;
  const channel = await client.channels.fetch(config.premiumLogChannelId).catch(() => null);
  if (!channel?.send) { logger.warn('Premium log: the channel could not be found.'); return false; }
  const cards = buildPremiumCards(await listActiveEntitlements());
  const before = await lastPosted(channel, client.user?.id);
  // A restart with nothing new says nothing: the same list is already there.
  if (before.length && before.map((message) => textOf({ components: message.components })).join('\n') === cards.map(textOf).join('\n')) return false;
  for (const card of cards) await channel.send({ components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  for (const message of before) await message.delete().catch(() => {});
  return true;
}

function startPremiumLogJob(client) {
  if (!config.premiumLogChannelId) return;
  // Once per start, a little after it so the cache and the database are ready.
  setTimeout(() => announceActivePremium(client).catch((error) => logger.warn(`Premium log failed: ${error.message}`)), START_DELAY_MS).unref?.();
}

module.exports = { startPremiumLogJob, announceActivePremium, buildPremiumCards, textOf };

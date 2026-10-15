// i18n-ignore-file: Premium list for the Petto team channel.
// When Petto starts it lists the Premium that is active in the channel of the team (PETTO_PREMIUM_LOG_CHANNEL_ID), so the team can see
// that the subscriptions that Polar reported reached the database. It does nothing when the channel is not set.
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
  const header = `## Premium active at start\n**${entitlements.length}** active subscription${entitlements.length === 1 ? '' : 's'}.`;
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

async function announceActivePremium(client) {
  if (!config.premiumLogChannelId) return false;
  const channel = await client.channels.fetch(config.premiumLogChannelId).catch(() => null);
  if (!channel?.send) { logger.warn('Premium log: the channel could not be found.'); return false; }
  const cards = buildPremiumCards(await listActiveEntitlements());
  for (const card of cards) await channel.send({ components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  return true;
}

function startPremiumLogJob(client) {
  if (!config.premiumLogChannelId) return;
  // Once per start, a little after it so the cache and the database are ready.
  setTimeout(() => announceActivePremium(client).catch((error) => logger.warn(`Premium log failed: ${error.message}`)), START_DELAY_MS).unref?.();
}

module.exports = { startPremiumLogJob, announceActivePremium, buildPremiumCards };

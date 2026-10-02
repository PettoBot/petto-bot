// Turns a saved image card into a picture for one message: loads the card, applies the Premium rules, fills in the
// variables for the member and the server, and draws it.
const { renderCard } = require('../imgutils/cardRenderer');
const { normalizeCard } = require('./cardSchema');
const { loadImageFromLink, decode } = require('./safeImage');
const { resolve } = require('./embedVariables');
const imageCards = require('../db/imageCards');
const cardAssets = require('../db/cardAssets');
const { getGuildPremium } = require('../db/premium');
const logger = require('./logger');

const CARD_FILE_NAME = 'card.png';
const PLACEMENTS = new Set(['default', 'embed', 'attachment']);

function avatarUrl(kind, ctx) {
  if (kind === 'server') return ctx.guild?.iconURL?.({ extension: 'png', size: 512 }) ?? null;
  const target = ctx.member ?? ctx.user ?? ctx.message?.author;
  return target?.displayAvatarURL?.({ extension: 'png', size: 512, forceStatic: true }) ?? null;
}

/** The functions the renderer needs, wired to one guild and one message. */
function depsFor(ctx, guildId) {
  return {
    resolveText: (text) => resolve(text, ctx),
    avatar: async (kind) => {
      const url = avatarUrl(kind, ctx);
      return url ? loadImageFromLink(url) : null;
    },
    loadSource: async (src) => {
      const asset = /^asset:(\d{1,18})$/.exec(src);
      if (asset) {
        const row = await cardAssets.getAsset(guildId, asset[1]).catch(() => null);
        if (!row) return null;
        try { return await decode(row.bytes); } catch { return null; }
      }
      return loadImageFromLink(src);
    },
  };
}

/**
 * Draws a card for a message. `premium` decides what is allowed: a card that uses the advanced editor or a Premium font
 * is drawn with its basic settings when the server is not Premium, so a card keeps working after Premium ends.
 */
async function drawCard(rawCard, ctx, { guildId, premium }) {
  let { card, usesAdvanced } = normalizeCard(rawCard, { premium });
  if (usesAdvanced && !premium) {
    ({ card } = normalizeCard({ mode: 'basic', width: card.width, height: card.height, background: card.background, basic: rawCard?.basic }, { premium: false }));
  }
  return renderCard(card, depsFor(ctx, guildId));
}

/**
 * The picture for a template that points at a card, as `{ buffer, name }`, or null when there is none to draw.
 * It never throws: a message is sent without its picture rather than not at all.
 */
async function renderCardForMessage(cardRef, ctx) {
  const guildId = ctx.guild?.id;
  if (!guildId || !cardRef?.name) return null;
  try {
    const row = await imageCards.getCard(guildId, cardRef.name);
    if (!row) return null;
    const premium = (await getGuildPremium(guildId)).active;
    const buffer = await drawCard(row.data, ctx, { guildId, premium });
    return { buffer, name: CARD_FILE_NAME };
  } catch (error) {
    logger.warn({ guildId, action: 'card-render' }, `Could not draw the image card ${cardRef.name}: ${error.message}`);
    return null;
  }
}

/** The rank card a server has not designed: a basic rank card, with its own color for voice. */
function defaultRankCard(source) {
  const voice = source === 'voice';
  return {
    kind: 'rank',
    mode: 'basic',
    basic: { preset: 'rank', accent: voice ? '#3ddc97' : '#8399ff', title: voice ? 'VOICE LEVEL {level}' : 'LEVEL {level}' },
    background: { color: '#1e1f22', gradient: voice ? { from: '#12372f', to: '#1e1f22', angle: 120 } : { from: '#2b2f6b', to: '#4a2b52', angle: 120 } },
  };
}

/**
 * The picture of the rank of one member. `cardName` is the card the server chose, or null for the default one. It never
 * throws: when the picture cannot be had the caller shows the embed alone.
 */
async function renderRankCard(ctx, cardName, source = 'messages') {
  const guildId = ctx.guild?.id;
  if (!guildId) return null;
  try {
    let raw = null;
    if (cardName) raw = (await imageCards.getCard(guildId, cardName))?.data ?? null;
    const premium = (await getGuildPremium(guildId)).active;
    const buffer = await drawCard(raw ?? defaultRankCard(source), ctx, { guildId, premium });
    return { buffer, name: CARD_FILE_NAME };
  } catch (error) {
    logger.warn({ guildId, action: 'rank-card' }, `Could not draw the rank card: ${error.message}`);
    return null;
  }
}

function normalizeCardRef(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return { name: imageCards.normalizeName(raw.name), placement: PLACEMENTS.has(raw.placement) ? raw.placement : 'default' };
}

module.exports = { CARD_FILE_NAME, PLACEMENTS, drawCard, renderCardForMessage, renderRankCard, defaultRankCard, normalizeCardRef };

// Turns a saved image card into a picture for one message: loads the card, applies the Premium rules, fills in the
// variables for the member and the server, and draws it.
const { renderCard } = require('../imgutils/cardRenderer');
const { normalizeCard } = require('./cardSchema');
const { BASIC_DEFAULTS, RANK_DEFAULTS, LEVELUP_DEFAULTS } = require('./cardPresets');
const { loadImageFromLink, decode } = require('./safeImage');
const { resolve } = require('./embedVariables');
const imageCards = require('../db/imageCards');
const cardAssets = require('../db/cardAssets');
const { getGuildPremium } = require('../db/premium');
const logger = require('./logger');
const { pullImgCards } = require('./imgCardTokens');
const { t, currentLanguage } = require('../i18n');
const fs = require('node:fs');
const path = require('node:path');

const CARD_FILE_NAME = 'card.png';
const PLACEMENTS = new Set(['default', 'embed', 'attachment']);

// The pictures that come with Petto (src/assets/backgrounds), read once and kept.
const bundled = new Map();
async function loadBundled(name) {
  if (bundled.has(name)) return bundled.get(name);
  let image = null;
  try { image = await decode(fs.readFileSync(path.join(__dirname, '../assets/backgrounds', `${name}.png`))); } catch { image = null; }
  bundled.set(name, image);
  return image;
}

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
      const own = /^petto:([a-z0-9-]{3,30})$/.exec(src);
      if (own) return loadBundled(own[1]);
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

// The texts of the basic editor that are Petto's defaults, with their keys in the embeds catalog. The dashboard saves them in
// English, so a text that is missing or still equal to the English default is drawn in the language of the server.
const DEFAULT_TEXTS = {
  rank: [['title', RANK_DEFAULTS.title, 'embeds.card.rankTitle'], ['extra', RANK_DEFAULTS.extra, 'embeds.card.rankExtra']],
  welcome: [['title', BASIC_DEFAULTS.title, 'embeds.card.welcomeTitle'], ['subtitle', BASIC_DEFAULTS.subtitle, 'embeds.card.welcomeSubtitle']],
};

/** The basic settings of a card with Petto's default texts in `lang`; what the server wrote is kept. */
function localizedBasic(basic, kind, lang) {
  const result = basic && typeof basic === 'object' && !Array.isArray(basic) ? { ...basic } : {};
  // The level-up layout has one text to translate: the line under the name (the chip of the position is only a variable).
  if (kind === 'rank' && result.preset === 'levelup') {
    if (result.subtitle === undefined || result.subtitle === LEVELUP_DEFAULTS.subtitle || result.subtitle === RANK_DEFAULTS.subtitle) result.subtitle = t(lang, 'embeds.card.levelUpSubtitle');
    return result;
  }
  for (const [field, english, key] of DEFAULT_TEXTS[kind]) {
    if (result[field] === undefined || result[field] === english) result[field] = t(lang, key);
  }
  return result;
}

/**
 * Draws a card for a message. `premium` decides what is allowed: a card that uses the advanced editor or a Premium font
 * is drawn with its basic settings when the server is not Premium, so a card keeps working after Premium ends. Petto's
 * default texts (the ones a server did not change) are drawn in `lang`.
 */
async function drawCard(rawCard, ctx, { guildId, premium, lang = ctx?.lang ?? currentLanguage() }) {
  const kind = rawCard?.kind === 'rank' ? 'rank' : 'welcome';
  const input = rawCard && typeof rawCard === 'object' && !Array.isArray(rawCard) ? { ...rawCard, basic: localizedBasic(rawCard.basic, kind, lang) } : rawCard;
  let { card, usesAdvanced } = normalizeCard(input, { premium, lang });
  if (usesAdvanced && !premium) {
    const basic = localizedBasic(rawCard?.basic, 'welcome', lang);
    ({ card } = normalizeCard({ mode: 'basic', width: card.width, height: card.height, background: card.background, basic }, { premium: false, lang }));
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

/**
 * The rank card a server has not designed: the layout with the avatar on the left and the bar under the level, in Petto's own colors
 * (peach for messages, teal for voice), over a picture that comes with Petto. Its texts are in `lang`.
 */
function defaultRankCard(source, lang = currentLanguage()) {
  const voice = source === 'voice';
  return {
    kind: 'rank',
    mode: 'basic',
    basic: { preset: 'rank', accent: voice ? '#5eead4' : '#ffb199', title: t(lang, voice ? 'embeds.card.rankVoiceTitle' : 'embeds.card.rankTitle'), extra: t(lang, 'embeds.card.rankExtra') },
    background: { color: '#120c1a', image: { src: voice ? 'petto:rank-voice' : 'petto:rank-default', fit: 'cover', blur: 0 } },
  };
}

/**
 * The picture of the rank of one member. `cardName` is the card the server chose, or null for the default one. It never
 * throws: when the picture cannot be had the caller shows the embed alone.
 */
async function renderRankCard(ctx, cardName, source = 'messages', lang = ctx?.lang ?? currentLanguage()) {
  const guildId = ctx.guild?.id;
  if (!guildId) return null;
  try {
    let raw = null;
    if (cardName) raw = (await imageCards.getCard(guildId, cardName))?.data ?? null;
    const premium = (await getGuildPremium(guildId)).active;
    const buffer = await drawCard(raw ?? defaultRankCard(source, lang), ctx, { guildId, premium, lang });
    return { buffer, name: CARD_FILE_NAME };
  } catch (error) {
    logger.warn({ guildId, action: 'rank-card' }, `Could not draw the rank card: ${error.message}`);
    return null;
  }
}

/**
 * A plain text message that may hold {imgcard:name}: `{ content, files }` with the text resolved and the card drawn when the text
 * asks for one. For the places that send text without building a whole design.
 */
async function plainMessage(text, ctx) {
  const pulled = pullImgCards({ content: String(text ?? '') });
  const content = await resolve(pulled.data.content, ctx);
  const card = normalizeCardRef(pulled.card);
  const picture = card ? await renderCardForMessage(card, ctx) : null;
  return picture ? { content, files: [{ attachment: picture.buffer, name: picture.name }] } : { content };
}

function normalizeCardRef(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return { name: imageCards.normalizeName(raw.name), placement: PLACEMENTS.has(raw.placement) ? raw.placement : 'default' };
}

module.exports = { CARD_FILE_NAME, PLACEMENTS, drawCard, renderCardForMessage, renderRankCard, defaultRankCard, normalizeCardRef, plainMessage };

// Turns a saved image card into a picture for one message: loads the card, applies the Premium rules, fills in the
// variables for the member and the server, and draws it.
const { renderCard } = require('../imgutils/cardRenderer');
const { normalizeCard } = require('./cardSchema');
const { BASIC_DEFAULTS, RANK_DEFAULTS, LEVELUP_DEFAULTS } = require('./cardPresets');
const { loadImageFromLink, fetchImageBuffer, decode } = require('./safeImage');
const { decodeApng } = require('../imgutils/apng');
const { resolve } = require('./embedVariables');
const imageCards = require('../db/imageCards');
const cardAssets = require('../db/cardAssets');
const { getGuildPremium } = require('../db/premium');
const logger = require('./logger');
const { pullImgCards } = require('./imgCardTokens');
const { t, currentLanguage } = require('../i18n');
const { loadDesignImage } = require('./cardDesigns');

const CARD_FILE_NAME = 'card.png';
const PLACEMENTS = new Set(['default', 'embed', 'attachment']);

function avatarUrl(kind, ctx) {
  if (kind === 'server') return ctx.guild?.iconURL?.({ extension: 'png', size: 512 }) ?? null;
  const target = ctx.member ?? ctx.user ?? ctx.message?.author;
  return target?.displayAvatarURL?.({ extension: 'png', size: 512, forceStatic: true }) ?? null;
}

// The decoration of an avatar that moves, as the animated picture of Discord's own CDN (the variable gives the still one).
const DECORATION_LINK = /^https:\/\/cdn\.discordapp\.com\/avatar-decoration-presets\/[A-Za-z0-9_\-]+\.png\?/;
const MAX_ANIMATION_BYTES = 2 * 1024 * 1024;
async function loadDecorationFrames(src) {
  if (!DECORATION_LINK.test(src)) return null;
  try {
    const link = src.replace(/([?&])passthrough=false/, '$1passthrough=true');
    return await decodeApng(await fetchImageBuffer(link, undefined, { maxBytes: MAX_ANIMATION_BYTES }));
  } catch {
    return null;
  }
}

/** The functions the renderer needs, wired to one guild and one message. A picture only moves for a Premium server. */
function depsFor(ctx, guildId, { premium = false, kind = 'welcome', userBanner = null } = {}) {
  return {
    loadFrames: premium ? loadDecorationFrames : undefined,
    // A background picture that cannot be had (a dead link, a deleted upload) is replaced by the default design of the kind of card.
    loadFallback: () => loadDesignImage(null, kind),
    resolveText: (text) => resolve(text, ctx),
    avatar: async (kind) => {
      const url = avatarUrl(kind, ctx);
      return url ? loadImageFromLink(url) : null;
    },
    loadSource: async (src) => {
      const own = /^petto:([a-z0-9-]{3,30})$/.exec(src);
      // The banner the member has on from the shop of the profile: only the one of the person the card is about (see `userBannerFor`).
      if (own && own[1] === 'user-banner') return userBanner ?? loadDesignImage(null, kind);
      if (own) return loadDesignImage(own[1], kind);
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
async function drawCard(rawCard, ctx, { guildId, premium, lang = ctx?.lang ?? currentLanguage(), userBanner = null }) {
  const kind = rawCard?.kind === 'rank' ? 'rank' : 'welcome';
  const input = rawCard && typeof rawCard === 'object' && !Array.isArray(rawCard) ? { ...rawCard, basic: localizedBasic(rawCard.basic, kind, lang) } : rawCard;
  let { card, usesAdvanced } = normalizeCard(input, { premium, lang });
  if (usesAdvanced && !premium) {
    const basic = localizedBasic(rawCard?.basic, 'welcome', lang);
    ({ card } = normalizeCard({ mode: 'basic', width: card.width, height: card.height, background: card.background, basic }, { premium: false, lang }));
  }
  return renderCard(card, depsFor(ctx, guildId, { premium, kind: card.kind, userBanner }));
}

/** The banner a person put on from the shop of the profile (`/profile banner`), as a picture, or null when they have none on or do not have the one they chose. Never throws. */
async function userBannerFor(userId, chosenId = null) {
  if (!userId) return null;
  try {
    // Loaded here, not at the top: the shop reads the database, and a card that is drawn without a person has no need of it.
    const registry = require('./badgeRegistry');
    const shopDb = require('../db/shop');
    await registry.ensure();
    const [active, items] = await Promise.all([shopDb.getActive(userId), shopDb.getUserItems(userId)]);
    // An own picture the team approved (only that one is ever drawn).
    if (chosenId === 'upload:own') {
      const own = await require('../db/userUploads').approvedBytes(userId);
      if (own) { const { loadImage } = require('@napi-rs/canvas'); return await loadImage(own); }
    }
    // The one the person chose for the card on the page "Rank card" (when they have it), otherwise the one they have on in the profile.
    const owns = (id) => id && items.some((row) => row.kind === 'banner' && row.id === id);
    const id = owns(chosenId) ? chosenId : (owns(active.banner) ? active.banner : null);
    return id ? await registry.bannerImage(id) : null;
  } catch { return null; }
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
function defaultRankCard(source, lang = currentLanguage(), withBanner = false, custom = null) {
  const voice = source === 'voice';
  // What the person designed on the page "Rank card" (`utils/userRankCard`): its colors, font and layout go over the basic settings, and its background over the picture.
  const own = custom?.basic ?? {};
  const background = custom?.background ?? { kind: 'default' };
  const useBanner = (background.kind === 'banner' || background.kind === 'shop' || background.kind === 'upload' || background.kind === 'default') && withBanner;
  const picture = background.kind === 'design' ? `petto:${background.id}` : (voice ? 'petto:rank-voice' : 'petto:rank-default');
  return {
    kind: 'rank',
    mode: 'basic',
    basic: { preset: 'rank', accent: voice ? '#5eead4' : '#ffb199', title: t(lang, voice ? 'embeds.card.rankVoiceTitle' : 'embeds.card.rankTitle'), extra: t(lang, 'embeds.card.rankExtra'), ...own },
    // With a banner of the shop the picture is the banner of the person, darkened a little so the numbers stay easy to read.
    background: useBanner
      ? { color: '#120c1a', image: { src: 'petto:user-banner', fit: 'cover', blur: 0 }, overlay: { color: '#0b0814', opacity: 0.42 } }
      : { color: '#120c1a', image: { src: picture, fit: 'cover', blur: 0 } },
  };
}

/** What a person designed for their own rank card, as `{ basic, background }` for `defaultRankCard`, or null when they designed nothing. Never throws. */
async function userRankCardFor(userId) {
  if (!userId) return null;
  try {
    const db = require('../db/userRankCard');
    const rules = require('./userRankCard');
    const designs = require('./cardDesigns');
    const row = await db.getRankCard(userId);
    if (!row || !Object.keys(row.settings).length) return null;
    const settings = rules.normalize(row.settings, (id) => Boolean(designs.getDesign(id)));
    return { basic: rules.toBasic(settings), background: rules.backgroundOf(settings) };
  } catch { return null; }
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
    // A server that designed its own rank card keeps its design (it can show the banner of each member with the picture `petto:user-banner`); the default card shows it by itself.
    const personId = (ctx.member ?? ctx.user ?? ctx.message?.author)?.id;
    // The card the person designed is only for the default card: a server that made its own keeps it.
    const custom = raw ? null : await userRankCardFor(personId);
    const userBanner = await userBannerFor(personId, custom?.background.kind === 'shop' ? custom.background.id : (custom?.background.kind === 'upload' ? 'upload:own' : null));
    // The card a person designed is theirs, not the server's: its fonts are the ones of the page (some are Premium ones for a server's own card), so it is not held back by the server's Premium.
    const buffer = await drawCard(raw ?? defaultRankCard(source, lang, Boolean(userBanner), custom), ctx, { guildId, premium: custom ? true : premium, lang, userBanner });
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

module.exports = { CARD_FILE_NAME, PLACEMENTS, drawCard, renderCardForMessage, renderRankCard, defaultRankCard, userRankCardFor, normalizeCardRef, plainMessage };

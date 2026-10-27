// The free games of the Epic Games Store: the weekly offers, the same list for everybody (the texts and the price are asked in the language and the country
// of each server). A public page of the store, no key and no account.
const { fetchJsonBody } = require('../http');

const LOCALES = { en: ['en-US', 'US'], es: ['es-ES', 'ES'], 'pt-BR': ['pt-BR', 'BR'] };
const clean = (text, max = 300) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (value) => (/^https:\/\//i.test(String(value ?? '')) ? String(value) : null);

/** The games that are free right now: `{ id, title, description, url, image, startsAt, endsAt }`. */
async function freeGames(lang = 'en') {
  const [locale, country] = LOCALES[lang] ?? LOCALES.en;
  const body = await fetchJsonBody(`https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=${locale}&country=${country}&allowCountries=${country}`);
  const out = [];
  for (const game of body?.data?.Catalog?.searchStore?.elements ?? []) {
    const offer = game?.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    if (!offer || game?.price?.totalPrice?.discountPrice !== 0) continue; // an upcoming offer, or a discount that is not free
    const slug = game.productSlug || game.offerMappings?.[0]?.pageSlug || game.catalogNs?.mappings?.[0]?.pageSlug || game.urlSlug;
    const picture = (game.keyImages ?? []).find((image) => image.type === 'OfferImageWide') ?? (game.keyImages ?? []).find((image) => image.type === 'Thumbnail') ?? game.keyImages?.[0];
    const thumb = (game.keyImages ?? []).find((image) => image.type === 'Thumbnail' || image.type === 'OfferImageTall');
    out.push({
      id: `${game.id}:${Date.parse(offer.startDate) || ''}`, title: clean(game.title, 120), description: clean(game.description, 240),
      url: slug ? `https://store.epicgames.com/${locale}/p/${String(slug).replace(/\/home$/, '')}` : 'https://store.epicgames.com/free-games',
      image: https(picture?.url), thumb: https(thumb?.url), startsAt: Date.parse(offer.startDate) || null, endsAt: Date.parse(offer.endDate) || null,
    });
  }
  return out;
}

module.exports = { freeGames };

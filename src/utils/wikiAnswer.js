// i18n-ignore-file: decides what !wiki answers (data only); the texts people read live in utils/wikiCards.js and the catalogs.
// From the words someone typed to what to show:
//   home        nothing typed: where to start
//   wiki        a page of the wiki (with the pages next to it)
//   terms       the points of the terms, privacy, refunds or cookies pages that answer the question (exact words of the page)
//   termsIndex  `!wiki terms` alone: the sections of the page, linked
//   termsNone   the page was read and nothing in it answers
//   termsError  the page could not be read
//   none        nothing in the wiki matches: the closest pages
//   error       the wiki could not be read at all
const W = require('./wikiSearch');

const QUERY_MAX = 200;
const MATCH_MIN = 1.7; // a page below this is a weak guess, not an answer
const STRONG = 5; // a word in the title or the path of a page
const RELATED = 4;
// How many of the pages shown get their title, description and picture read (the first is the card, the next two get a small picture).
const WITH_META = 3;
// The pages that exist only in English.
const ENGLISH_ONLY = new Set(['changelog']);

// A question: a question mark, or a first word that asks.
const QUESTION = /\?|^\s*¿?\s*(how|can|could|do|does|did|what|whats|why|when|will|is|are|where|puedo|puede|como|que|cual|cuando|donde|por que|posso|pode|quando|qual|onde)\b/i;
// Words every question about Petto has: they do not tell the passages apart.
const GENERIC = new Set(['server', 'servidor', 'member', 'miembro', 'membro', 'user', 'usuario', 'people', 'persona', 'gente']);
const specificTerms = (list) => { const kept = list.filter((term) => !GENERIC.has(term)); return kept.length ? kept : list; };
const cleanQuery = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);

const pageUrl = (page, lang, meta) => W.wikiUrl(page.path, ENGLISH_ONLY.has(page.path) ? 'en' : (meta?.lang ?? lang));

/** A page with what is known of it in the language: { page, meta, url, title, description }. */
function present(page, meta, lang) {
  return {
    page,
    meta: meta ?? null,
    url: pageUrl(page, lang, meta),
    title: meta?.title ?? page.title,
    // The list is in English: another language shows a description only when the page itself was read.
    description: meta?.description ?? (lang === 'en' ? page.description : null),
    image: meta?.image ?? null,
    imageAlt: meta?.alt ?? null,
  };
}

/** The pages with their meta read for the first `WITH_META`. */
async function presentAll(pages, lang) {
  const metas = await Promise.all(pages.map((page, index) => (index < WITH_META ? W.getPageMeta(page, lang) : null)));
  return pages.map((page, index) => present(page, metas[index], lang));
}

// A look into the terms that nobody asked for by name does not hold the answer up for long.
const SPECULATIVE_MS = 3500;

async function loadDocs(docs, lang, { speculative = false } = {}) {
  const settled = await Promise.allSettled(docs.map(async (doc) => ({ doc, ...(await W.getLegal(doc, lang, { timeoutMs: speculative ? SPECULATIVE_MS : undefined })) })));
  return { loaded: settled.filter((s) => s.status === 'fulfilled').map((s) => s.value), failed: settled.some((s) => s.status === 'rejected') };
}

async function pagesOrNull() {
  try {
    return await W.getPages();
  } catch {
    return null;
  }
}

/**
 * What to answer to `query` in `lang`. `hints` are extra words that only help to rank (the category of the command that was named,
 * `moderation` for `!wiki ban`).
 */
async function answer(rawQuery, lang = 'en', { hints = [] } = {}) {
  const query = cleanQuery(rawQuery);
  const terms = W.tokensOf(query);

  if (!terms.length) {
    const pages = await pagesOrNull();
    if (!pages?.length) return { kind: 'error', query };
    const shown = await presentAll(pages.slice(0, 1 + RELATED), lang);
    return { kind: 'home', query, top: shown[0], related: shown.slice(1) };
  }

  // The question is about a page of the website by name.
  const named = W.explicitDocs(terms);
  if (named.length) {
    const rest = terms.filter((term) => !W.explicitDocs([term]).length && !W.FILLER.has(term));
    // Only the name of a page (`terms`, `privacy policy`) shows its index; a question (`can I get a refund?`) is searched, with the name too.
    const asking = QUESTION.test(W.fold(query));
    // The name of a page that is a word in its text (`refund`, `cookies`) is part of the question; `terms` and `privacy` are not.
    const words = named.filter((doc) => doc === 'refunds' || doc === 'cookies').flatMap((doc) => terms.filter((term) => W.explicitDocs([term]).includes(doc)));
    const search = specificTerms(rest.length ? [...rest, ...words] : (asking ? terms.filter((term) => !W.FILLER.has(term)) : []));
    const { loaded, failed } = await loadDocs(search.length ? named : [named[0]], lang);
    if (!loaded.length) return { kind: 'termsError', query, docs: named };
    if (!search.length) return { kind: 'termsIndex', query, doc: loaded[0].doc, title: loaded[0].title, sections: loaded[0].sections, others: named.slice(1) };
    const hits = W.searchLegal(loaded, search);
    if (W.answers(hits, { lenient: true })) return { kind: 'terms', query, hits, docs: named, partial: failed, related: await relatedPage(rest.join(' '), lang, hints) };
    return { kind: 'termsNone', query, docs: named, partial: failed };
  }

  const pages = await pagesOrNull();
  const ranked = pages ? W.rankPages(pages, query, { hints, limit: 1 + RELATED, min: 1 }) : [];
  const top = ranked[0]?.score ?? 0;
  const soft = W.hintedDocs(terms);

  // A question can be answered by the terms even when it did not name them: a ban, a deleted message, a payment.
  const tryTerms = (soft.length > 0 && (terms.length >= 2 || top < STRONG)) || (top < STRONG && terms.length >= 2) || top < MATCH_MIN;
  if (tryTerms) {
    const { loaded } = await loadDocs(soft.length ? soft : W.DOCS, lang, { speculative: true });
    if (loaded.length) {
      const hits = W.searchLegal(loaded, specificTerms(terms));
      if (W.answers(hits, { lenient: soft.length > 0 })) {
        const related = top >= STRONG ? await relatedPage(specificTerms(terms).join(' '), lang, hints) : null;
        return { kind: 'terms', query, hits, docs: loaded.map((l) => l.doc), partial: false, related };
      }
    }
  }

  if (!pages) return { kind: 'error', query };
  if (top >= MATCH_MIN) {
    const shown = await presentAll(ranked.filter((r) => r.score >= MATCH_MIN).map((r) => r.page), lang);
    return { kind: 'wiki', query, top: shown[0], related: shown.slice(1, 1 + RELATED) };
  }
  const close = ranked.length ? ranked.map((r) => r.page) : pages.slice(0, RELATED + 1);
  return { kind: 'none', query, close: close.map((page) => present(page, null, lang)), guess: ranked.length > 0 };
}

/** The best page of the wiki for a question the terms answered: a line "also in the wiki", or null. */
async function relatedPage(query, lang, hints) {
  const pages = await pagesOrNull();
  const best = pages ? W.rankPages(pages, query, { hints, limit: 1, min: STRONG })[0] : null;
  return best ? (await presentAll([best.page], lang))[0] : null;
}

module.exports = { answer, cleanQuery, present, MATCH_MIN, STRONG, QUERY_MAX };

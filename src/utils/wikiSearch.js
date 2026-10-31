// i18n-ignore-file: search data and fetching for !wiki (word lists, addresses); the texts people read live in the catalogs.
// What !wiki knows, read live and kept small:
//   - the page list of the wiki (llms.txt: title, path, description), capped, for 30 minutes;
//   - for the pages that are shown: the title, the description and the first picture of the page (its `.md`), for 30 minutes;
//   - the sections of the terms, privacy, refunds and cookies pages of the website, in the language asked, for 30 minutes.
// Only the extracted text is kept, never a page. Every download is cut at 1 MB and gives up after 8 seconds.
const { SUPPORT_URL, WIKI_URL } = require('./links');

const SITE_URL = 'https://petto.sbs';
const INDEX_URL = `${WIKI_URL}/llms.txt`;

/** Limits, in one place so a check can shrink them. */
const limits = {
  ttlMs: 30 * 60 * 1000,
  failureMs: 30 * 1000,
  timeoutMs: 8000,
  maxBytes: 1024 * 1024,
  maxPages: 300,
  maxMeta: 60,
  maxLegalChars: 300 * 1024,
  maxDocChars: 80 * 1024,
  maxSections: 60,
  maxPoints: 30,
  pointChars: 600,
};

const DOCS = ['terms', 'privacy', 'refunds', 'cookies'];
const LANG_PREFIX = { en: '', es: 'es', 'pt-BR': 'pt-br' };

const prefixOf = (lang) => LANG_PREFIX[lang] ?? '';
/** The address of a page of the website (`terms`) in a language, with an optional anchor. */
function siteUrl(doc, lang, anchor = null) {
  const prefix = prefixOf(lang);
  return `${SITE_URL}/${prefix ? `${prefix}/` : ''}${doc}${anchor ? `#${anchor}` : ''}`;
}
/** The address of a wiki page (`moderation/moderation`) in a language; the home with no path. */
function wikiUrl(path = '', lang = 'en') {
  const prefix = prefixOf(lang);
  return [WIKI_URL, prefix, path].filter(Boolean).join('/');
}

// ------------------------------------------------------------------------------------------------------------------ text

/** Lower case, no accents: `Términos` is `terminos`. */
const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const wordsOf = (value) => fold(value).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/** A plural is its singular: only a trailing `s` goes (prefix matching does the rest). */
const stem = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, Math.max(1, limit - 1));
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

const STOP = new Set(fold(`
a an the of to in on at for and or is are was be can could would should do does did i you we they it my me your our with from about as by if up use using usar usando utilizar
how what when where why who which this that these those there here please petto bot wiki tell show find get need want know have has
el la los las un una unos unas de del al y o u en con por para que como es son puedo puede pueden se mi mis tu tus su sus lo le les
qué cuál cuando donde dónde cómo quién sobre sin más pero esto eso esta este hay ser hacer quiero necesito saber tiene tienen
um uma uns umas do da dos das e ou em no na nos nas com por para que como é são posso pode podem meu minha seu sua ao aos mais mas
isso isto qual quando onde quem sobre sem tem têm ser fazer quero preciso saber
`).split(/\s+/).filter(Boolean));

// Words that mean the same in en, es and pt: a Spanish question finds the English page and the other way round. The pages of the wiki
// list is in English, so this is how `silenciar` finds `mute`.
const GROUPS = [
  ['ban', 'banned', 'banear', 'baneo', 'baneado', 'baneada', 'banir', 'banido', 'banida', 'banimento', 'vetar'],
  ['mute', 'muted', 'silenciar', 'silencio', 'silenciado', 'mutar', 'timeout', 'aislar'],
  ['warn', 'warning', 'advertencia', 'advertir', 'aviso', 'avisar'],
  ['kick', 'expulsar', 'expulsion', 'expulsao'],
  ['jail', 'carcel', 'prision', 'prisao', 'cadeia'],
  ['welcome', 'bienvenida', 'bienvenido', 'boas', 'vindas'],
  ['level', 'leveling', 'nivel', 'niveles', 'niveis', 'xp', 'rank'],
  ['giveaway', 'sorteo', 'sorteio'],
  ['ticket', 'soporte', 'suporte', 'support'],
  ['log', 'registro', 'auditoria'],
  ['role', 'roles', 'rol', 'cargo', 'cargos'],
  ['automod', 'automoderacion', 'automoderacao', 'spam', 'antispam'],
  ['prefix', 'prefijo', 'prefixo'],
  ['language', 'idioma', 'lenguaje', 'lingua'],
  ['setup', 'configurar', 'configuracion', 'configuracao', 'instalar', 'config', 'settings', 'ajustes'],
  ['permission', 'permiso', 'permissao', 'permissoes', 'hierarchy', 'jerarquia', 'hierarquia'],
  ['command', 'comando'],
  ['embed', 'incrustado'],
  ['backup', 'respaldo', 'vault', 'copia'],
  ['invite', 'invitar', 'invitacion', 'invitaciones', 'convite'],
  ['music', 'musica'],
  ['counter', 'contador', 'contadores'],
  ['reaction', 'reaccion', 'reaccion', 'reacao'],
  ['premium', 'plus'],
  ['verification', 'verificacion', 'verificacao', 'verify', 'verificar'],
  ['birthday', 'cumpleanos', 'aniversario'],
  ['poll', 'encuesta', 'enquete'],
  ['suggestion', 'sugerencia', 'sugestao'],
  ['starboard', 'estrellas', 'estrelas'],
  ['raid', 'anti', 'proteccion', 'protecao', 'security', 'seguridad', 'seguranca'],
  // The pages of the website.
  ['term', 'terminos', 'termo', 'tos', 'condition', 'condiciones', 'condicoes', 'conditions'],
  ['privacy', 'privacidad', 'privacidade', 'personal', 'gdpr'],
  ['refund', 'reembolso', 'reembolsar', 'devolucion', 'devolver', 'estorno', 'chargeback', 'reembolsos'],
  ['cookie', 'cookies'],
  ['delete', 'borrar', 'eliminar', 'excluir', 'apagar', 'erase', 'remove'],
  ['data', 'datos', 'dados', 'information', 'informacion', 'informacao'],
  ['payment', 'pago', 'pagamento', 'pay', 'pagar', 'billing', 'subscription', 'suscripcion', 'assinatura', 'purchase', 'compra', 'compras'],
  ['cancel', 'cancelar', 'cancelacion', 'cancelamento'],
  ['liability', 'responsabilidad', 'responsabilidade', 'warranty', 'garantia'],
].map((group) => [...new Set(group.map((word) => stem(fold(word))))]);

const GROUP_OF = new Map();
GROUPS.forEach((group, index) => group.forEach((word) => { if (!GROUP_OF.has(word)) GROUP_OF.set(word, index); }));
/** The words that mean the same as `term` (a stem), without `term` itself. */
const synonymsOf = (term) => (GROUP_OF.has(term) ? GROUPS[GROUP_OF.get(term)].filter((word) => word !== term) : []);

// The pages of the website, by the words that name them: a question with one of these is about that page.
const DOC_WORDS = {
  terms: ['terms', 'term', 'tos', 'conditions', 'condition', 'terminos', 'condiciones', 'termos', 'condicoes'],
  privacy: ['privacy', 'privacidad', 'privacidade'],
  refunds: ['refund', 'refunds', 'reembolso', 'reembolsos', 'reembolsar', 'estorno', 'chargeback', 'devolucion'],
  cookies: ['cookie', 'cookies'],
};
// Words that point at a page without being its name: they choose where to look, they do not force the answer to come from there.
const DOC_HINTS = {
  terms: ['ban', 'banned', 'banear', 'banir', 'liability', 'responsabilidad', 'responsabilidade', 'age', 'edad', 'idade', 'abuse', 'abuso'],
  privacy: ['data', 'datos', 'dados', 'personal', 'delete', 'borrar', 'eliminar', 'excluir', 'gdpr', 'store', 'stored', 'guardar'],
  refunds: ['payment', 'pago', 'pagamento', 'billing', 'subscription', 'suscripcion', 'assinatura', 'cancel', 'cancelar', 'purchase', 'compra', 'premium', 'charge'],
  cookies: [],
};
const stemSet = (list) => new Set(list.map((word) => stem(fold(word))));
const DOC_WORD_SETS = Object.fromEntries(DOCS.map((doc) => [doc, stemSet(DOC_WORDS[doc])]));
const DOC_HINT_SETS = Object.fromEntries(DOCS.map((doc) => [doc, stemSet(DOC_HINTS[doc])]));
// Words that only say what kind of page it is (`terms of service`, `política de privacidad`).
const FILLER = stemSet(['service', 'servicio', 'servico', 'policy', 'politica', 'use', 'uso', 'legal']);

/** The meaningful words of a text (no stop words, singular, no repeats). */
function tokensOf(value) {
  return [...new Set(wordsOf(value).filter((word) => !STOP.has(word)).map(stem))];
}

/** Whether `word` (from the text) matches `term` (from the query): the same, or the word starts with the term (from 4 letters: `level` finds `leveling`). */
function wordMatch(word, term) {
  if (word === term) return 2;
  if (term.length >= 4 && word.startsWith(term)) return 1;
  return 0;
}
function bestMatch(words, term) {
  let best = 0;
  for (const word of words) {
    const hit = wordMatch(word, term);
    if (hit === 2) return 2;
    if (hit > best) best = hit;
  }
  return best;
}

// ------------------------------------------------------------------------------------------------------------------ download

const failures = new Map(); // address -> { at, error }
const inflight = new Map(); // address -> promise

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`); // i18n-ignore: internal error, never shown
    this.status = status;
  }
}

/** The text of an address, at most `limits.maxBytes` of it (more is an error), 8 seconds at most (`timeoutMs` can be less). A failure is remembered for a moment. */
async function download(url, { timeoutMs = limits.timeoutMs } = {}) {
  const failed = failures.get(url);
  if (failed && Date.now() - failed.at < limits.failureMs) throw failed.error;
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, { signal, redirect: 'follow', headers: { accept: 'text/markdown, text/html, text/plain;q=0.8' } });
      if (!response.ok) throw new HttpError(response.status, url);
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > limits.maxBytes) throw new Error(`Too large: ${url}`); // i18n-ignore: internal error
      if (!response.body?.getReader) {
        const text = await response.text();
        if (text.length > limits.maxBytes) throw new Error(`Too large: ${url}`); // i18n-ignore: internal error
        return text;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limits.maxBytes) {
          reader.cancel().catch(() => {});
          throw new Error(`Too large: ${url}`); // i18n-ignore: internal error
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } catch (error) {
      failures.set(url, { at: Date.now(), error });
      if (failures.size > 50) failures.delete(failures.keys().next().value);
      throw error;
    }
  })().finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}

// ------------------------------------------------------------------------------------------------------------------ the wiki's page list

let pagesCache = null; // { at, pages }

/** Reads the lines of llms.txt (`- [Title](url): description`) into { title, path, description }, at most `limits.maxPages`. */
function parsePages(text) {
  const pages = [];
  for (const match of String(text).matchAll(/^- \[([^\]]+)\]\(([^)\s]+)\):\s*(.+)$/gm)) {
    let path = match[2].replace(/\.md$/, '').replace(/[?#].*$/, '');
    if (path.startsWith(WIKI_URL)) path = path.slice(WIKI_URL.length);
    path = path.replace(/^\/+|\/+$/g, '');
    if (!path || /^https?:/i.test(path)) continue;
    pages.push({ title: clip(match[1], 120), path, description: clip(match[3], 300) });
    if (pages.length >= limits.maxPages) break;
  }
  return pages;
}

/** The pages of the wiki. When the wiki cannot be reached, the last list is used if there is one (an old list is better than none). */
async function getPages() {
  if (pagesCache && Date.now() - pagesCache.at < limits.ttlMs) return pagesCache.pages;
  try {
    const pages = parsePages(await download(INDEX_URL));
    if (!pages.length) throw new Error('The wiki index has no pages'); // i18n-ignore: internal error
    pagesCache = { at: Date.now(), pages };
    return pages;
  } catch (error) {
    if (pagesCache) return pagesCache.pages;
    throw error;
  }
}

/**
 * The pages that fit the words, best first: `{ page, score }`. A word found in the title or the path weighs most, in the description
 * less; words that mean the same in another language count too; `hints` are extra words (the category of a command) that only help.
 */
function rankPages(pages, query, { hints = [], limit = 5, min = 1 } = {}) {
  const terms = tokensOf(query);
  const extra = hints.flatMap((hint) => tokensOf(hint));
  if (!terms.length && !extra.length) return [];
  const ranked = [];
  pages.forEach((page, order) => {
    const titleWords = wordsOf(page.title).map(stem);
    const pathWords = wordsOf(page.path).map(stem);
    const descWords = wordsOf(page.description).map(stem);
    const descHead = descWords.slice(0, 8); // what a page lists first is what it is about
    const weigh = (term, scale) => {
      let best = 0;
      for (const variant of [term, ...synonymsOf(term)]) {
        const factor = (variant === term ? 1 : 0.85) * scale;
        const title = bestMatch(titleWords, variant);
        const path = bestMatch(pathWords, variant);
        const desc = bestMatch(descWords, variant);
        const early = desc === 2 && bestMatch(descHead, variant) === 2 ? 0.8 : 0;
        const head = Math.max(title === 2 ? 6 : title === 1 ? 4 : 0, path === 2 ? 5 : path === 1 ? 3 : 0);
        const score = factor * (head + ((desc === 2 ? 2 : desc === 1 ? 1 : 0) + early) * (head ? 0.5 : 1));
        if (score > best) best = score;
      }
      return best;
    };
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const part = weigh(term, 1);
      if (part > 0) matched += 1;
      score += part;
    }
    if (terms.length > 1 && matched === terms.length) score += 2;
    for (const term of extra) score += Math.min(weigh(term, 0.5), 3);
    if (score >= min) ranked.push({ page, score: Math.round(score * 100) / 100, order });
  });
  ranked.sort((a, b) => b.score - a.score || a.page.path.length - b.page.path.length || a.order - b.order);
  return ranked.slice(0, limit).map(({ page, score }) => ({ page, score }));
}

// ------------------------------------------------------------------------------------------------------------------ the picture of a page

const metaCache = new Map(); // `${lang}:${path}` -> { at, meta }

/** Markdown escapes (`\_`, `\&`) taken out. */
const unescapeMarkdown = (value) => String(value ?? '').replace(/\\([\\`*_{}[\]()#+\-.!&<>~|"'])/g, '$1');

/** The title, description and first picture (`/images/...`, https only) of a page written in Markdown. */
function parseMarkdownPage(markdown) {
  const text = String(markdown ?? '');
  const heading = /^#\s+(.+)$/m.exec(text);
  const title = heading?.[1]?.trim() ?? null;
  // The description is the first quote under the title, before the first section (the index note Mintlify puts above the title is not it).
  const afterTitle = heading ? text.slice(heading.index + heading[0].length) : text;
  const description = /^>\s+(.+)$/m.exec(afterTitle.split(/^##\s/m)[0])?.[1]?.trim() ?? null;
  let image = null;
  let alt = null;
  for (const match of text.matchAll(/!\[((?:\\.|[^\]\\])*)\]\(\s*(\S+?)\s*\)/g)) {
    const url = unescapeMarkdown(match[2]);
    if (!/^https:\/\//i.test(url) || !/\/images\//i.test(url) || url.length > 1500) continue;
    image = url;
    alt = clip(unescapeMarkdown(match[1]), 300) || null;
    break;
  }
  return { title: title ? clip(unescapeMarkdown(title), 120) : null, description: description ? clip(unescapeMarkdown(description), 300) : null, image, alt };
}

/**
 * The title, description and picture of a page in a language (the English page when that one does not exist), from its `.md`.
 * `null` when the page cannot be read: the caller keeps what the list says and shows no picture.
 */
async function getPageMeta(page, lang) {
  const key = `${lang}:${page.path}`;
  const cached = metaCache.get(key);
  if (cached && Date.now() - cached.at < limits.ttlMs) return cached.meta;
  const read = async (language) => parseMarkdownPage(await download(`${wikiUrl(page.path, language)}.md`));
  let meta = null;
  try {
    try {
      meta = { ...(await read(lang)), lang };
    } catch (error) {
      if (lang === 'en' || !(error instanceof HttpError) || error.status !== 404) throw error;
      meta = { ...(await read('en')), lang: 'en' };
    }
  } catch {
    meta = null;
  }
  if (meta) {
    metaCache.set(key, { at: Date.now(), meta });
    while (metaCache.size > limits.maxMeta) metaCache.delete(metaCache.keys().next().value);
  }
  return meta;
}

// ------------------------------------------------------------------------------------------------------------------ the terms

const legalCache = new Map(); // `${lang}:${doc}` -> { at, doc }

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', copy: '©', middot: '·', bull: '•' };
/** HTML character references (`&amp;`, `&#39;`, `&#x27;`) turned into the characters. Unknown ones stay as they are. */
function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** The text of a piece of HTML: no tags, entities decoded, white space collapsed. Nothing in it is ever run. */
function htmlText(html) {
  return decodeEntities(String(html).replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The sections of a legal page of the website: `<div class="legal-block" id="…">` with an `<h2>` (the number in a span) and the points
 * of the section as `<li>` (or one `<p>`). Each section: { id, n, heading, points: [{ n, text }] }. Long points are cut at `limits.pointChars`.
 */
function parseLegalPage(html) {
  const source = String(html).replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const title = htmlText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(source)?.[1] ?? '') || null;
  const marker = /<div\b[^>]*\bclass="[^"]*\blegal-block\b[^"]*"[^>]*>/gi;
  const starts = [];
  for (let match = marker.exec(source); match; match = marker.exec(source)) {
    starts.push({ at: match.index, end: match.index + match[0].length, id: /\bid="([^"]+)"/i.exec(match[0])?.[1] ?? null });
  }
  const sections = [];
  let total = 0;
  starts.forEach((start, index) => {
    if (sections.length >= limits.maxSections) return;
    let body = source.slice(start.end, starts[index + 1]?.at ?? source.length);
    const top = body.search(/<a\b[^>]*\blegal-top\b/i);
    if (top >= 0) body = body.slice(0, top);
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(body);
    if (!h2) return;
    const number = htmlText(/<span\b[^>]*\blegal-n\b[^>]*>([\s\S]*?)<\/span>/i.exec(h2[1])?.[1] ?? '').replace(/\.$/, '') || null;
    const heading = htmlText(h2[1].replace(/<span\b[^>]*\blegal-n\b[^>]*>[\s\S]*?<\/span>/i, ''));
    if (!heading) return;
    const after = body.slice(h2.index + h2[0].length);
    let raw = [...after.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)].map((li) => ({ n: /\bdata-n="([^"]+)"/i.exec(li[1])?.[1] ?? null, text: htmlText(li[2]) }));
    if (!raw.length) raw = [...after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => ({ n: number, text: htmlText(p[1]) }));
    const points = [];
    for (const point of raw) {
      if (!point.text || points.length >= limits.maxPoints) continue;
      const text = clip(point.text, limits.pointChars);
      if (total + text.length > limits.maxDocChars) break;
      total += text.length;
      points.push({ n: point.n, text });
    }
    if (points.length) sections.push({ id: start.id, n: number, heading: clip(heading, 160), points });
  });
  return { title: title ? clip(title, 120) : null, sections };
}

const legalSize = (entry) => entry.doc.sections.reduce((sum, s) => sum + s.heading.length + s.points.reduce((n, p) => n + p.text.length, 0), 0);

/** The sections of one legal page in a language ({ title, sections }), read live and kept for 30 minutes. */
async function getLegal(doc, lang, { timeoutMs } = {}) {
  if (!DOCS.includes(doc)) throw new Error(`Unknown page: ${doc}`); // i18n-ignore: internal error
  const key = `${lang}:${doc}`;
  const cached = legalCache.get(key);
  if (cached && Date.now() - cached.at < limits.ttlMs) return cached.doc;
  let parsed;
  try {
    parsed = parseLegalPage(await download(siteUrl(doc, lang), { timeoutMs }));
    if (!parsed.sections.length) throw new Error(`No sections found in ${doc}`); // i18n-ignore: internal error
  } catch (error) {
    if (cached) return cached.doc; // the page cannot be read right now: what was read before is still the text of the page
    throw error;
  }
  legalCache.set(key, { at: Date.now(), doc: parsed });
  let size = 0;
  for (const entry of legalCache.values()) size += legalSize(entry);
  while (size > limits.maxLegalChars && legalCache.size > 1) {
    const oldest = legalCache.keys().next().value;
    size -= legalSize(legalCache.get(oldest));
    legalCache.delete(oldest);
  }
  return parsed;
}

/** The pages of the website a query is about by name: `terms`, `privacy`, `refund`, `cookies` (in the three languages). */
function explicitDocs(terms) {
  return DOCS.filter((doc) => terms.some((term) => DOC_WORD_SETS[doc].has(term)));
}
/** The pages a query points at without naming them (`ban` -> terms, `delete my data` -> privacy). */
function hintedDocs(terms) {
  return DOCS.filter((doc) => terms.some((term) => DOC_HINT_SETS[doc].has(term)));
}

/**
 * A piece of a point (at most `limit` characters) that starts at the sentence with the words of the question, so what is shown is
 * what answers. Only whole sentences of the page, never reworded; `…` marks where the text goes on.
 */
function excerptOf(text, terms, limit) {
  const value = String(text).replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const sentences = value.split(/(?<=[.!?;:])\s+/);
  const score = (sentence) => {
    const words = wordsOf(sentence).map(stem);
    return terms.reduce((sum, term) => sum + ([term, ...synonymsOf(term)].some((variant) => bestMatch(words, variant)) ? 1 : 0), 0);
  };
  let first = 0;
  let best = -1;
  sentences.forEach((sentence, index) => {
    const points = score(sentence);
    if (points > best) { best = points; first = index; }
  });
  let last = first;
  let out = sentences[first];
  while (last + 1 < sentences.length && out.length + 1 + sentences[last + 1].length <= limit) { last += 1; out += ` ${sentences[last]}`; }
  while (first > 0 && out.length + 1 + sentences[first - 1].length <= limit && out.length < limit * 0.5) { first -= 1; out = `${sentences[first]} ${out}`; }
  if (out.length > limit) out = clip(out, limit);
  return `${first > 0 ? '… ' : ''}${out}${last < sentences.length - 1 && !out.endsWith('…') ? ' …' : ''}`;
}

/**
 * The points of the sections that answer the words: `{ doc, section, point, score, covered }`, best first, one per section.
 * `covered` is how many of the words the point (with the heading) has.
 */
function searchLegal(loaded, terms, { limit = 3, excerptChars = 380 } = {}) {
  if (!terms.length) return [];
  const variantsOf = (term) => [term, ...synonymsOf(term)];
  const prepared = loaded.map(({ doc, sections }) => ({
    doc,
    sections: sections.map((section) => ({ section, headingWords: wordsOf(section.heading).map(stem), points: section.points.map((point) => ({ point, words: wordsOf(point.text).map(stem) })) })),
  }));
  // A word that most of the points have (`server`) says little: it counts a little and does not make the point an answer.
  const total = prepared.reduce((sum, { sections }) => sum + sections.reduce((n, s) => n + s.points.length, 0), 0);
  const common = new Set();
  if (total >= 20) {
    for (const term of terms) {
      let seen = 0;
      for (const { sections } of prepared) for (const s of sections) for (const p of s.points) if (variantsOf(term).some((variant) => bestMatch(p.words, variant))) seen += 1;
      if (seen / total > 0.2) common.add(term);
    }
  }
  const significant = terms.filter((term) => !common.has(term)).length;

  const hits = [];
  prepared.forEach(({ doc, sections }, docOrder) => {
    sections.forEach(({ section, headingWords, points }, sectionOrder) => {
      let best = null;
      for (const { point, words } of points) {
        let score = 0;
        let covered = 0;
        for (const term of terms) {
          let part = 0;
          for (const variant of variantsOf(term)) {
            const factor = variant === term ? 1 : 0.85;
            const inHeading = bestMatch(headingWords, variant);
            const inText = bestMatch(words, variant);
            part = Math.max(part, factor * ((inHeading === 2 ? 3 : inHeading === 1 ? 2 : 0) + (inText === 2 ? 2 : inText === 1 ? 1 : 0)));
          }
          if (part > 0 && !common.has(term)) covered += 1;
          score += common.has(term) ? part * 0.25 : part;
        }
        if (score > 0 && (!best || score > best.score)) best = { doc, section, point, score, covered, significant, order: docOrder * 1000 + sectionOrder };
      }
      if (best) hits.push(best);
    });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  const floor = (hits[0]?.score ?? 0) * 0.5;
  return hits.filter((hit) => hit.score >= floor).slice(0, limit).map((hit) => ({ ...hit, excerpt: excerptOf(hit.point.text, terms, excerptChars) }));
}

/**
 * Whether the best point really answers the question: it has the words that matter (two of them, or the only one) and not only a word
 * that every point has.
 */
function answers(hits, { lenient = false } = {}) {
  if (!hits.length) return false;
  const [best] = hits;
  // When the question names the page (`refunds`), one word of the question in a point is enough to show it; searching all the pages needs two.
  const need = lenient ? 1 : Math.max(1, Math.min(2, best.significant));
  return best.covered >= need && best.score >= 1.5;
}

/** Forgets everything that was kept (the checks start from nothing). */
function resetCaches() {
  pagesCache = null;
  metaCache.clear();
  legalCache.clear();
  failures.clear();
  inflight.clear();
}

/** What is kept now, for the checks: how many entries and how many characters of legal text. */
function cacheStats() {
  let chars = 0;
  for (const entry of legalCache.values()) chars += legalSize(entry);
  return { pages: pagesCache?.pages.length ?? 0, meta: metaCache.size, legal: legalCache.size, legalChars: chars };
}

module.exports = {
  SITE_URL, INDEX_URL, SUPPORT_URL, DOCS, limits,
  siteUrl, wikiUrl, fold, wordsOf, stem, clip, tokensOf, synonymsOf, explicitDocs, hintedDocs, FILLER,
  download, HttpError, parsePages, getPages, rankPages,
  parseMarkdownPage, getPageMeta, excerptOf, decodeEntities, htmlText, parseLegalPage, getLegal, searchLegal, answers,
  resetCaches, cacheStats,
};

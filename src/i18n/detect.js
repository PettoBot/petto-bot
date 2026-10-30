// The language a server probably speaks, found with what Petto can already see of it: no external service, nothing is sent anywhere.
//
// 1. `guild.preferredLocale` is only the choice of a server that turned Community on; every other server reports `en-US` whatever
//    language it speaks (Discord: "the preferred locale of a Community guild ... defaults to en-US"). So only an explicit Spanish or
//    Portuguese locale is trusted. English (en-US, en-GB) and every other locale say nothing.
// 2. Otherwise the words the server itself wrote: its name and description, the names of its channels, categories and roles, the
//    system channel and the rules channel. A small list of words and stems per language is counted; a language is chosen only when it
//    clearly wins (see `chooseFromWords`). Anything unclear stays English, the language Petto always had.
//
// `detectGuildLanguage(guild)` is pure (it only reads the object it is given), so `scripts/check-guild-language.js` can test it with plain objects.

const MAX_ITEMS = 300; // channels, and roles, looked at (a huge server does not make this slow)
const MIN_MATCHES = 2; // distinct words a language needs before it can win

// Words are written without accents and in lower case (the text is normalized the same way before it is compared). A word ending in `*` is
// a stem: it matches any word that starts with it. Words with a space are phrases (`boas vindas` also matches `boas-vindas` and `boas_vindas`).
// A word that is a normal word of two languages is listed in both (`SHARED_ES_PT`): it can never make one of them win over the other.
// The words English has too (`general`, `chat`, `staff`, `logs`...) are left out: they say nothing.
const SPANISH = [
  'reglas', 'regla', 'reglamento', 'bienvenid*', 'charla', 'charlas', 'sugerencias', 'sugerencia', 'soporte', 'miembros', 'miembro',
  'comunidad', 'novedades', 'informacion', 'presentaciones', 'presentacion', 'despedida', 'despedidas', 'sorteos', 'ayuda', 'quejas',
  'verificacion', 'verificate', 'reclutamiento', 'tienda', 'preguntas', 'canales', 'hablar', 'invitaciones', 'alianzas', 'juegos',
  'fuera de tema', 'espanol', 'jugadores', 'amistades', 'normativa', 'reportes', 'bots y comandos', 'tema libre',
];
const PORTUGUESE = [
  'regras', 'regra', 'regulamento', 'boas vindas', 'bem vind*', 'bate papo', 'sugestoes', 'sugestao', 'suporte', 'membros', 'membro',
  'comunidade', 'novidades', 'apresentacao', 'apresentacoes', 'despedidas', 'sorteios', 'ajuda', 'denuncias', 'verificacao', 'recrutamento',
  'loja', 'perguntas', 'canais', 'conversa', 'convites', 'parcerias', 'jogos', 'fora do assunto', 'portugues', 'cargos', 'geral', 'divulgacao',
  'fale conosco', 'resenha', 'musicas', 'jogadores', 'amizades',
];
const ENGLISH = [
  'rules', 'welcome', 'announcements', 'announcement', 'suggestions', 'suggestion', 'support', 'members', 'community', 'news', 'updates',
  'introductions', 'introduction', 'off topic', 'giveaways', 'giveaway', 'help', 'moderators', 'channels', 'games', 'music', 'voice', 'lounge',
  'hangout', 'partners', 'partnerships', 'verify', 'verification', 'events', 'server', 'faq', 'goodbye', 'looking for group', 'self roles',
];
// Spanish and Portuguese write these the same way: they count for both.
const SHARED_ES_PT = [
  'anuncios', 'anuncio', 'avisos', 'canal', 'musica', 'noticias', 'eventos', 'servidor', 'entrada', 'salida', 'sala', 'salas', 'voz',
  'moderadores', 'administradores', 'importante', 'normas', 'amigos',
];
// Function words, used only for a description (a long text). Names of channels never count them: `los` is a normal word in "Los Angeles".
const PROSE = {
  es: ['el', 'los', 'las', 'del', 'una', 'nuestro', 'nuestra', 'nuestros', 'donde', 'puedes', 'pueden', 'hola', 'gracias', 'unete'],
  'pt-BR': ['os', 'uma', 'nosso', 'nossa', 'nossos', 'voce', 'voces', 'seja', 'venha', 'tambem', 'nao', 'obrigado', 'obrigada', 'ola'],
  en: ['the', 'and', 'our', 'you', 'your', 'join', 'with', 'this', 'here', 'are', 'of', 'for', 'welcome'],
};

const WORDS = {
  es: [...SPANISH, ...SHARED_ES_PT],
  'pt-BR': [...PORTUGUESE, ...SHARED_ES_PT],
  en: ENGLISH,
};

/** `Règlas`, `𝐑𝐮𝐥𝐞𝐬` and `📢┃Anuncios` -> a string of lower case words with one space between them and no accents or symbols. */
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
}

// Each entry becomes a regex over the normalized text: a whole word or phrase, or the start of a word for a stem.
function compile(entry) {
  const stem = entry.endsWith('*');
  const body = (stem ? entry.slice(0, -1) : entry).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { entry, regex: new RegExp(`(?:^| )(${body}${stem ? '[a-z0-9]*' : ''})(?= |$)`) };
}
const COMPILED = Object.fromEntries(Object.entries(WORDS).map(([lang, list]) => [lang, list.map(compile)]));
const COMPILED_PROSE = Object.fromEntries(Object.entries(PROSE).map(([lang, list]) => [lang, list.map(compile)]));

/** The language of an explicit Discord locale: es-ES, es-419 and es -> es; pt-BR, pt-PT and pt -> pt-BR; anything else (en-US included) null. */
function languageOfLocale(locale) {
  const raw = String(locale ?? '').toLowerCase();
  if (/^es(-|$)/.test(raw)) return 'es';
  if (/^pt(-|$)/.test(raw)) return 'pt-BR';
  return null;
}

const take = (collection) => {
  const values = typeof collection?.values === 'function' ? collection.values() : Array.isArray(collection) ? collection : [];
  const list = [];
  for (const value of values) {
    list.push(value);
    if (list.length >= MAX_ITEMS) break;
  }
  return list;
};

/** The texts of a server that say something about its language: [{ text, prose }]. */
function guildTexts(guild) {
  const texts = [];
  const add = (text, prose = false) => { if (typeof text === 'string' && text.trim()) texts.push({ text, prose }); };
  add(guild?.name);
  add(guild?.description, true);
  for (const channel of take(guild?.channels?.cache)) add(channel?.name);
  for (const role of take(guild?.roles?.cache)) if (!role?.managed) add(role?.name); // the role of a bot is named after the bot
  add(guild?.systemChannel?.name);
  add(guild?.rulesChannel?.name);
  add(guild?.publicUpdatesChannel?.name);
  return texts;
}

/** What each language matched: { es: Map(entry -> the word found), 'pt-BR': Map, en: Map }. */
function matchWords(texts) {
  const found = { es: new Map(), 'pt-BR': new Map(), en: new Map() };
  for (const { text, prose } of texts) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    for (const lang of Object.keys(found)) {
      const lists = prose ? [COMPILED[lang], COMPILED_PROSE[lang]] : [COMPILED[lang]];
      for (const list of lists) {
        for (const { entry, regex } of list) {
          if (found[lang].has(entry)) continue;
          const match = regex.exec(normalized);
          if (match) found[lang].set(entry, match[1]);
        }
      }
    }
  }
  return found;
}

/**
 * Which language wins: at least MIN_MATCHES distinct words, and strictly more than every other language, English included. A tie
 * (a server in two languages, or one that only uses words both languages share) is English: Petto does not guess.
 */
function chooseFromWords(found) {
  const counts = { es: found.es.size, 'pt-BR': found['pt-BR'].size, en: found.en.size };
  const [best] = ['es', 'pt-BR'].sort((a, b) => counts[b] - counts[a]);
  const others = ['es', 'pt-BR', 'en'].filter((lang) => lang !== best);
  const clear = counts[best] >= MIN_MATCHES && others.every((lang) => counts[best] > counts[lang]);
  return { language: clear ? best : null, counts };
}

/**
 * @param {object} guild a discord.js Guild, or any object with the same fields (`name`, `description`, `preferredLocale`, `channels.cache`,
 *   `roles.cache`, `systemChannel`, `rulesChannel`).
 * @returns {{ language: 'en'|'es'|'pt-BR', source: 'locale'|'words'|'default', locale: string|null, words: string[], scores: {es: number, 'pt-BR': number, en: number} }}
 *   `source` says why: the explicit locale, the words found (listed in `words`), or nothing pointed anywhere (English).
 */
function detectGuildLanguage(guild) {
  const locale = typeof guild?.preferredLocale === 'string' ? guild.preferredLocale : null;
  const fromLocale = languageOfLocale(locale);
  if (fromLocale) return { language: fromLocale, source: 'locale', locale, words: [], scores: { es: 0, 'pt-BR': 0, en: 0 } };

  const found = matchWords(guildTexts(guild));
  const { language, counts } = chooseFromWords(found);
  if (language) {
    // The words that say the most go first (the order of the lists: words of only that language, then the shared ones, then the function words of a description).
    const order = [...WORDS[language], ...PROSE[language]];
    const words = [...found[language]].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([, word]) => word);
    return { language, source: 'words', locale, words: words.slice(0, 5), scores: counts };
  }
  return { language: 'en', source: 'default', locale, words: [], scores: counts };
}

/** One line for the log: `es (locale en-US, words: reglas, bienvenidas)`. No names of members, only the words of the list that matched. */
function describeDetection(detection) {
  const words = detection.words.length ? detection.words.join(', ') : 'none';
  return `${detection.language} (locale ${detection.locale ?? 'unknown'}, words: ${words})`;
}

module.exports = { detectGuildLanguage, describeDetection, languageOfLocale, normalizeText, WORDS };

/**
 * Everyday words (English, Spanish and Portuguese) that are also short command words. A command word prefix such as `petto` starts a
 * command whenever the next word is one Petto knows, so `petto is the best` must not run `!is` (image sepia): after a word prefix a
 * word of this list is never a command. With a symbol prefix (`!is`, `,is`, a personal prefix) it works as usual, and a real command
 * is never affected (`petto help`).
 * Only whole words are listed, in lower case, with no accents (the way commands are typed).
 */
const COMMON_WORDS = new Set([
  // English
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'did', 'do', 'for', 'get', 'go', 'had', 'has',
  'he', 'her', 'him', 'his', 'how', 'i', 'if', 'im', 'in', 'is', 'it', 'its', 'ive', 'let', 'me', 'my', 'no', 'nor', 'not', 'now', 'of',
  'off', 'oh', 'ok', 'on', 'one', 'or', 'our', 'out', 'she', 'so', 'than', 'that', 'the', 'then', 'they', 'this', 'to', 'too', 'up', 'us',
  'was', 'we', 'who', 'why', 'will', 'with', 'yes', 'yet', 'you',
  // Spanish
  'al', 'ah', 'ay', 'con', 'cual', 'de', 'del', 'el', 'ella', 'ellos', 'en', 'eres', 'es', 'esa', 'ese', 'eso', 'esta', 'este', 'esto',
  'fue', 'ha', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'muy', 'ni', 'nos', 'o', 'para', 'por', 'pues', 'que',
  'quien', 'se', 'ser', 'si', 'sin', 'son', 'soy', 'su', 'sus', 'te', 'ti', 'tu', 'tus', 'un', 'una', 'uno', 'unos', 'va', 'vez', 'y', 'ya',
  'yo',
  // Portuguese
  'ao', 'aos', 'ate', 'da', 'das', 'dos', 'ela', 'ele', 'eles', 'eu', 'foi', 'ja', 'mais', 'mas', 'na', 'nas', 'nao', 'nos',
  'num', 'os', 'ou', 'pra', 'pro', 'quem', 'sao', 'sem', 'sim', 'tem', 'um', 'uma', 'vou', 'voce',
]);

/** Whether a word is an everyday word (any case, accents ignored), so it must not start a command after a word prefix. */
function isCommonWord(word) {
  const plain = String(word ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return COMMON_WORDS.has(plain);
}

module.exports = { COMMON_WORDS, isCommonWord };

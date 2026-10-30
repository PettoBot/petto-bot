// The command prefixes of a server, apart from Discord and the database so the rules can be checked on their own.
// A server has a list of them (the first is the main one: the one shown in cards and help, and the only one that answers
// "I don't know that command"). The old `guilds.prefix` column keeps the main one for compatibility.
const { t, currentLanguage } = require('../i18n');

/** What a server has when it never chose anything: Petto's usual `!` and the word `petto` (`petto help`). `,` is an option, not a default. */
const DEFAULT_PREFIXES = Object.freeze(['!', 'petto']);
const MAX_PREFIXES = 10;
const MAX_LENGTH = 12;

/** A prefix that ends in a letter or a number is a word (`petto`): it needs a space after it. The rest (`!`, `,`, `p!`) is a symbol and is typed attached to the command. */
const isWordPrefix = (prefix) => /[\p{L}\p{N}]$/u.test(String(prefix ?? ''));

const sameKey = (prefix) => String(prefix).toLocaleLowerCase();

/** Returns the prefix cleaned up, or `{ error }` with what is wrong with it (in `lang`). */
function validatePrefix(input, lang = currentLanguage()) {
  const value = String(input ?? '').trim();
  if (!value) return { error: t(lang, 'core.prefix.invalid.empty') };
  if (value.length > MAX_LENGTH) return { error: t(lang, 'core.prefix.invalid.tooLong', { max: MAX_LENGTH }) };
  if (/\s/.test(value)) return { error: t(lang, 'core.prefix.invalid.spaces') };
  if (value.includes('@') || value.includes('`')) return { error: t(lang, 'core.prefix.invalid.forbidden') };
  return { prefix: value };
}

/** The same list without repeats (the case does not count), in the order it came. */
function dedupe(list) {
  const seen = new Set();
  return list.filter((prefix) => {
    const key = sameKey(prefix);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The prefixes of a server from its row: the saved list, or (a server that never had one) the old single prefix, or `!`.
 * What is saved is read as it is, without the new rules: a server that has a longer or odd prefix from before keeps it.
 */
function prefixesOf(row) {
  const saved = Array.isArray(row?.prefixes) ? row.prefixes.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean) : [];
  if (saved.length) return dedupe(saved);
  const old = typeof row?.prefix === 'string' ? row.prefix.trim() : '';
  return [old || '!'];
}

/** The main prefix of a server: the first of its list. */
const primaryPrefix = (row) => prefixesOf(row)[0];

/** The columns to save for a list: the list itself, and its first prefix in the old column. */
const columnsFor = (list) => ({ prefixes: list, prefix: list[0] });

/** Checks a whole list (from the dashboard): `{ prefixes }` cleaned up, or `{ error }`. */
function validateList(input, lang = currentLanguage()) {
  if (!Array.isArray(input)) return { error: t(lang, 'core.prefix.invalid.empty') };
  const list = [];
  for (const item of input) {
    const checked = validatePrefix(item, lang);
    if (checked.error) return checked;
    if (list.some((p) => sameKey(p) === sameKey(checked.prefix))) return { error: t(lang, 'core.prefix.invalid.duplicate', { prefix: checked.prefix }) };
    list.push(checked.prefix);
  }
  if (!list.length) return { error: t(lang, 'core.prefix.invalid.none') };
  if (list.length > MAX_PREFIXES) return { error: t(lang, 'core.prefix.invalid.limit', { max: MAX_PREFIXES }) };
  return { prefixes: list };
}

/** `!prefix add`: the list with one more, or `{ error }`. */
function addToList(list, input, lang = currentLanguage()) {
  const checked = validatePrefix(input, lang);
  if (checked.error) return checked;
  if (list.some((p) => sameKey(p) === sameKey(checked.prefix))) return { error: t(lang, 'core.prefix.invalid.duplicate', { prefix: checked.prefix }) };
  if (list.length >= MAX_PREFIXES) return { error: t(lang, 'core.prefix.invalid.limit', { max: MAX_PREFIXES }) };
  return { prefixes: [...list, checked.prefix], prefix: checked.prefix };
}

/** `!prefix remove`: the list without one, or `{ error }` (it must be there, and the last one cannot go). */
function removeFromList(list, input, lang = currentLanguage()) {
  const value = String(input ?? '').trim();
  if (!value) return { error: t(lang, 'core.prefix.invalid.empty') };
  const found = list.find((p) => sameKey(p) === sameKey(value));
  if (!found) return { error: t(lang, 'core.prefix.notFound', { prefix: value }) };
  if (list.length <= 1) return { error: t(lang, 'core.prefix.lastOne', { prefix: found }) };
  return { prefixes: list.filter((p) => p !== found), prefix: found };
}

/**
 * The ways a message can start a command with a list of prefixes, the longest prefix first (`!!` before `!`).
 * `entries`: `[{ prefix, source, main }]`. A symbol prefix takes the command attached to it (`,help`): a space after it (`, hello`,
 * `! hello`) is not a command. A word prefix needs a space and a word after it (`petto help`); the case does not count for either.
 * Each way is `{ typedPrefix, commandName, argText, source, main, word }`: `typedPrefix` is what the person typed (a word one keeps the
 * space, so it can be put in front of a command name again).
 */
function candidatesFor(content, entries) {
  if (typeof content !== 'string' || !content) return [];
  const lower = content.toLocaleLowerCase();
  const found = [];
  const ordered = entries.map((entry, order) => ({ ...entry, order })).sort((a, b) => b.prefix.length - a.prefix.length || a.order - b.order);
  for (const entry of ordered) {
    const { prefix } = entry;
    if (!prefix || content.length <= prefix.length || !lower.startsWith(prefix.toLocaleLowerCase())) continue;
    const word = isWordPrefix(prefix);
    const rest = content.slice(prefix.length);
    const match = word ? /^(\s+)(\S+)(?:\s+([\s\S]*))?$/.exec(rest) : /^()(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
    if (!match) continue;
    found.push({
      typedPrefix: word ? `${content.slice(0, prefix.length)} ` : content.slice(0, prefix.length),
      commandName: match[2].toLowerCase(),
      argText: match[3] ?? '',
      source: entry.source,
      main: Boolean(entry.main),
      word,
    });
  }
  return found;
}

/**
 * The prefix a message starts with, or null. `prefixes`: the list of the server (the first is the main one); `personal`: the prefix
 * of the person, or null; `isKnown(name)`: whether a word is a command, an alias or a custom command (asked only for a word prefix:
 * `petto es el mejor` is chat, `petto help` is a command).
 */
async function matchPrefix(content, { prefixes, personal = null, isKnown = async () => true }) {
  const entries = prefixes.map((prefix, index) => ({ prefix, source: 'server', main: index === 0 }));
  if (personal && !entries.some((entry) => sameKey(entry.prefix) === sameKey(personal))) entries.push({ prefix: personal, source: 'personal', main: false });
  for (const way of candidatesFor(content, entries)) {
    if (way.word && !(await isKnown(way.commandName))) continue;
    return way;
  }
  return null;
}

/**
 * Whether an unknown word after a prefix gets the "I don't know that command" answer: from the main prefix of the server, and from the
 * personal prefix of the person (they chose it for themselves, and the answer is only for them), written like a command and never after
 * a word prefix. The other prefixes of the server (`petto`, a `,` that was added) leave it as chat.
 */
function answersUnknown(way) {
  return Boolean(way && (way.main || way.source === 'personal') && !way.word && /^[\p{L}\p{N}]/u.test(way.commandName));
}

module.exports = {
  DEFAULT_PREFIXES, MAX_PREFIXES, MAX_LENGTH,
  isWordPrefix, validatePrefix, validateList, addToList, removeFromList,
  prefixesOf, primaryPrefix, columnsFor, candidatesFor, matchPrefix, answersUnknown,
};

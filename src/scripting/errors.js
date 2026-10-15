// The mistakes of Petto Code. Each one is a phrase: a key of the `scripting` catalog and its values, so it can be said in the
// language of the server that runs the code, and said again later in another one (`!customcommand logs`). A value of a phrase
// can be another phrase (`{ key, vars }`), a text or a number.
const { t, currentLanguage } = require('../i18n');

const phrase = (key, vars = {}) => ({ key, vars });
const isPhrase = (value) => Boolean(value) && typeof value === 'object' && typeof value.key === 'string';

/** A phrase (or a plain text) in words, in `lang`. */
function say(lang, value) {
  if (!isPhrase(value)) return value;
  const vars = {};
  for (const [name, inner] of Object.entries(value.vars ?? {})) vars[name] = say(lang, inner);
  return t(lang, value.key, vars);
}

/** A mistake found inside a function or a value (`dbGet: …`); the interpreter turns it into a PettoCodeError. */
class CodeProblem extends Error {
  constructor(key, vars = {}, { limit = false, bare = false, lang = currentLanguage() } = {}) {
    const said = phrase(key, vars);
    super(say(lang, said));
    this.name = 'CodeProblem';
    this.phrase = said;
    if (limit) this.limit = true;
    if (bare) this.bare = true;
  }
}

/**
 * An error of Petto Code: a mistake in the code ('syntax'), while running ('runtime') or a limit that was hit ('limit').
 * `detail` is a phrase (or a text that is said as it is). `code` is the key of the phrase, for code that needs to tell one
 * mistake from another without reading its words.
 */
class PettoCodeError extends Error {
  constructor(kind, detail, position = {}, lang = currentLanguage()) {
    const said = isPhrase(detail) ? detail : null;
    const text = said ? say(lang, said) : String(detail);
    super(position.line ? t(lang, 'scripting.error.where', { message: text, line: position.line, column: position.column }) : text);
    this.name = 'PettoCodeError';
    this.kind = kind;
    this.line = position.line ?? null;
    this.column = position.column ?? null;
    this.detail = text;
    this.phrase = said;
    this.code = said?.key ?? null;
  }

  /** The mistake alone, in `lang`. */
  detailIn(lang) {
    return this.phrase ? say(lang, this.phrase) : this.detail;
  }

  /** The mistake with its line and column, as a phrase that can be said later in any language. */
  toPhrase() {
    const inner = this.phrase ?? this.detail;
    return this.line ? phrase('scripting.error.where', { message: inner, line: this.line, column: this.column }) : inner;
  }

  /** The mistake with its line and column, in `lang`. */
  messageIn(lang) {
    return say(lang, this.toPhrase());
  }
}

module.exports = { PettoCodeError, CodeProblem, phrase, isPhrase, say };

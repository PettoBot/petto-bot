// Petto Code: the template language of custom commands, in the style of YAGPDB's. `parse` checks the code, `run` runs it
// with the data it may see and gives back the text and the effects (what to do in Discord).
const { parse, MAX_SOURCE_LENGTH } = require('./parser');
const { run, DEFAULT_LIMITS } = require('./interpreter');
const { functions } = require('./functions');
const { PettoCodeError } = require('./errors');

/** The mistake in some code, or null when it is fine, so an editor can show it. */
function check(source) {
  try { parse(source); return null; } catch (error) {
    if (error instanceof PettoCodeError) return { kind: error.kind, message: error.detail, line: error.line, column: error.column };
    throw error;
  }
}

module.exports = { parse, run, check, PettoCodeError, DEFAULT_LIMITS, MAX_SOURCE_LENGTH, functionNames: () => [...functions.keys()].sort() };

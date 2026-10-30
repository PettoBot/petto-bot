// What the member typed for a prefix. `!prefix set ?` and `!prefix ?` both mean the prefix `?`: a `set` in front is dropped (as in
// `!counting set`), so it is not read as part of a prefix with a space in it.
const { MAX_LENGTH } = require('./guildPrefixes');

function readPrefixInput(text) {
  const raw = String(text ?? '').trim();
  const withSet = /^set\s+(\S.*)$/i.exec(raw);
  return (withSet ? withSet[1] : raw).trim();
}

const isValidPrefix = (prefix) => Boolean(prefix) && prefix.length <= MAX_LENGTH && !/[\s@`]/.test(prefix);

module.exports = { readPrefixInput, isValidPrefix };

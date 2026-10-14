// What the member typed for the new prefix. `!prefix ?` and `!prefix set ?` both mean the prefix `?`: the word `set` in front is
// dropped (as in `!counting set`), so it is not read as part of a prefix with a space in it.
function readPrefixInput(text) {
  const raw = String(text ?? '').trim();
  const withSet = /^set\s+(\S.*)$/i.exec(raw);
  return (withSet ? withSet[1] : raw).trim();
}

const isValidPrefix = (prefix) => Boolean(prefix) && prefix.length <= 5 && !/\s/.test(prefix);

module.exports = { readPrefixInput, isValidPrefix };

// How a live counter turns into a channel name, and when the channel is worth renaming.
// Kept free of Discord and database imports so scripts/check-counters.js can run it on its own.

// Discord lets a channel be renamed about twice every ten minutes. Asking more often does not rename it
// faster: the request waits in line, and a single waiting rename used to hold up every other counter.
const MIN_RENAME_GAP_MS = 5 * 60_000;

/**
 * Text and announcement channels cannot hold spaces or capitals: Discord lowercases the name and turns spaces
 * into hyphens. Comparing the raw wanted name with the stored one never matched, so those counters were
 * renamed on every pass. Voice channels, stages and categories keep the name as written.
 */
function normalizeForType(name, channelType) {
  if (channelType === 'voice' || channelType === 'category' || channelType === 'stage') return name;
  return name.toLowerCase().replace(/\s+/g, '-');
}

function renderName(row, value) {
  const template = row.name_template || '{option}: {value}';
  const text = template
    .replaceAll('{option}', row.counter_option)
    .replaceAll('{value}', String(value))
    .replaceAll('{remaining}', String(value));
  return `${row.prefix ?? ''}${text}${row.suffix ?? ''}`.slice(0, 100);
}

function sameName(current, wanted, channelType) {
  return current === wanted || current === normalizeForType(wanted, channelType);
}

/**
 * Decides whether a rename is worth asking Discord for.
 * `lastWanted` and `lastStored` are what this process asked for and what Discord kept the last time, so a name
 * Discord rewrites in its own way is not asked for again while it is still the same value.
 */
function shouldRename({ currentName, wantedName, channelType, lastWanted, lastStored, renamedAt, now }) {
  if (sameName(currentName, wantedName, channelType)) return false;
  if (lastWanted === wantedName && lastStored !== undefined && currentName === lastStored) return false;
  if (renamedAt !== undefined && now - renamedAt < MIN_RENAME_GAP_MS) return false;
  return true;
}

module.exports = { MIN_RENAME_GAP_MS, normalizeForType, renderName, sameName, shouldRename };

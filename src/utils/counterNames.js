// How a live counter turns into a channel name, and when the channel is worth renaming.
// Kept free of Discord and database imports so scripts/check-counters.js can run it on its own.
const { t, currentLanguage } = require('../i18n');

// What a counter can count. `{option}` in a name shows it in the server's language (in English, the option itself).
const OPTIONS = ['members', 'users_only', 'bots_only', 'pending_members', 'all_channels', 'text_channels', 'voice_channels', 'categories', 'announcement_channels', 'staging_channels', 'boosts', 'booster_count'];

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

/** The name of a counter option in `lang`; a countdown's timestamp and anything unknown stay as they are. */
function optionLabel(option, lang = currentLanguage()) {
  return OPTIONS.includes(option) ? t(lang, `counters.option.${option}`) : option;
}

/**
 * The channel name of a counter. The name only depends on the server's language, so it stays the same from one pass to the
 * next and is renamed once when the language changes.
 */
function renderName(row, value, lang = currentLanguage()) {
  const template = row.name_template || '{option}: {value}'; // i18n-ignore: a template, its words come from optionLabel
  const text = template
    .replaceAll('{option}', optionLabel(row.counter_option, lang))
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

module.exports = { MIN_RENAME_GAP_MS, OPTIONS, optionLabel, normalizeForType, renderName, sameName, shouldRename };

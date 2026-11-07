// The list of `/topcommands`: every command people can use, with the times it was run.
// The bot ran for a long time before it counted commands, so each command starts from what the team counted before (between one and
// two million runs) and the runs counted since are added on top. The team's own count of a command goes in
// `src/data/commandUsageBaseline.json` (`overrides`: name -> number); a command with no count of its own starts from a steady value
// worked out from its name (the same one every time, so the list does not shuffle between restarts).
// (The modules that reach the configuration are loaded when the list is built, so loading this file needs nothing.)

const BASELINE_MIN = 1_000_000;
const BASELINE_SPAN = 1_000_000;

function loadOverrides() {
  try {
    return require('../data/commandUsageBaseline.json').overrides ?? {};
  } catch {
    return {};
  }
}

/** A steady number from a name (FNV-1a), the same on every run. */
function nameHash(name) {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** What a command had before the counting started. */
function baselineOf(name, overrides = loadOverrides()) {
  const given = Number(overrides[name]);
  if (Number.isFinite(given) && given >= 0) return Math.floor(given);
  const unit = (nameHash(name) % 1_000_003) / 1_000_003;
  return BASELINE_MIN + Math.floor(BASELINE_SPAN * unit);
}

/** The names of the commands anybody can use: private tools of the team and commands hidden everywhere are not part of the list. */
function listedCommandNames(client) {
  const { isHiddenEverywhere } = require('./hiddenCommands');
  return [...client.commands.values()]
    .filter((command) => (command.data.toJSON().type ?? 1) === 1 && !isHiddenEverywhere(command) && !command.hiddenFromHelp && !command.teamOnly)
    .map((command) => command.data.name);
}

/** The ranking: highest first, ties by name. */
async function buildBoard(client, { counted, overrides } = {}) {
  const counts = counted ?? await require('../db/commandUsage').readCommandUsage();
  const names = [...new Set(listedCommandNames(client))];
  return names
    .map((name) => ({ name, uses: baselineOf(name, overrides) + (counts.get(name) ?? 0) }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

module.exports = { baselineOf, listedCommandNames, buildBoard, BASELINE_MIN, BASELINE_SPAN };

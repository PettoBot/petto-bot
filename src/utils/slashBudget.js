// How much room Petto has left in the slash commands Discord allows an application: 100 chat input commands, 5 user menus and 5 message menus
// (global), 25 subcommands or groups in each command level, and 8000 characters of definition per command. Pure functions over the commands'
// JSON, so the numbers can be checked without Discord.
const LIMITS = Object.freeze({ chat: 100, user: 5, message: 5, subcommands: 25, size: 8000 });

const TYPE_OF = { 1: 'chat', 2: 'user', 3: 'message' };
const typeOf = (command) => TYPE_OF[command?.type ?? 1] ?? 'chat';

/** How many commands of each kind, and what is left of each limit. */
function slotUsage(commands) {
  const used = { chat: 0, user: 0, message: 0 };
  for (const command of commands) used[typeOf(command)] += 1;
  return Object.fromEntries(Object.keys(used).map((kind) => [kind, { used: used[kind], limit: LIMITS[kind], free: Math.max(0, LIMITS[kind] - used[kind]) }]));
}

/** The subcommands and groups at the first level of a command. */
const subcommandCount = (command) => (command?.options ?? []).filter((option) => option.type === 1 || option.type === 2).length;

/** Discord counts the characters of the names, descriptions and choices of a command and all its options (and the localizations); this adds them up. */
function commandSize(command) {
  const text = (value) => (typeof value === 'string' ? value.length : 0);
  const localized = (map) => Object.values(map ?? {}).reduce((sum, value) => sum + text(value), 0);
  const visit = (node) => {
    let size = text(node.name) + text(node.description) + localized(node.name_localizations) + localized(node.description_localizations);
    for (const choice of node.choices ?? []) size += text(choice.name) + (typeof choice.value === 'string' ? choice.value.length : 0) + localized(choice.name_localizations);
    for (const option of node.options ?? []) size += visit(option);
    return size;
  };
  return visit(command);
}

/** The commands close to a limit (or at it): `{ name, subcommands, size, full }`, the fullest first. */
function nearLimit(commands, { subcommands = 22, size = 6500 } = {}) {
  return commands
    .filter((command) => typeOf(command) === 'chat')
    .map((command) => ({ name: command.name, subcommands: subcommandCount(command), size: commandSize(command) }))
    .filter((entry) => entry.subcommands >= subcommands || entry.size >= size)
    .map((entry) => ({ ...entry, full: entry.subcommands >= LIMITS.subcommands || entry.size >= LIMITS.size }))
    .sort((a, b) => b.subcommands - a.subcommands || b.size - a.size);
}

/** Names that Discord has registered and Petto does not load any more, and the other way round (not registered yet). */
function difference(registered, loaded) {
  const have = new Set(registered.map((command) => `${typeOf(command)}:${command.name}`));
  const want = new Set(loaded.map((command) => `${typeOf(command)}:${command.name}`));
  return { onlyRegistered: [...have].filter((key) => !want.has(key)).sort(), notRegistered: [...want].filter((key) => !have.has(key)).sort() };
}

module.exports = { LIMITS, slotUsage, subcommandCount, commandSize, nearLimit, difference };

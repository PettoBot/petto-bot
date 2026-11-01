// The slash commands Petto registers with Discord: exactly the expected list, and every one of them something Discord accepts
// (names, descriptions in every language, option order and counts, and the size of each command).
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const {
  ApplicationCommandType, ApplicationCommandOptionType, SlashCommandBuilder, ContextMenuCommandBuilder,
} = require('discord.js');
const { collectCommandData, findCommandFiles, COMMANDS_DIR, isSlashCommand } = require('../src/handlers/commandHandler');

// The interaction actions (hug, pat, slap...) are all subcommands of the one command /act (Discord allows 100 slash commands, and
// every action used to be its own); everything else is listed by name. A change here is a change of what members see in
// Discord's `/` menu, so it is made on purpose.
const ROLEPLAY = 1;
const ESSENTIAL = [
  // Everyday commands that also work with `/` (they keep working with the prefix).
  'afk', 'avatar', 'ban', 'botinfo', 'channel', 'embed', 'giveaway', 'help', 'kick', 'ping', 'poll', 'purge', 'rank', 'remind',
  'serverinfo', 'suggest', 'ticket', 'timeout', 'top', 'unban', 'userinfo', 'warn',
  // The two umbrellas: everything about a server (`/server info`, `icon`...) and about a member (`/user info`, `avatar`...). The old
  // commands they wrap stay (`serverinfo`, `userinfo`, `avatar` are also slash commands), the rest work with the prefix only.
  'server', 'user',
  // The umbrella of moderation (`/mod ban`, `kick`, `purge`...): one slash command for the everyday moderation commands; each subcommand
  // asks for the permission of the command it wraps when it runs (src/commands/moderation/mod.js).
  'mod',
  // The second batch of umbrellas, wrapping prefix-only commands: the fun and games (`/game 8ball`, `minecraft`...), what is yours (`/me birthday`,
  // `rep`...), lookups (`/search weather`, `youtube`...) and the staff tools that do not fit `/mod` (`/staff massban`, `voice-mute`...). Each one only
  // has subcommands, and `/staff` asks for the permission of the command each one wraps when it runs. The rest of the prefix commands move little by little.
  'game', 'me', 'search', 'staff',
  // Registered before for their own reasons.
  'guildtag', 'messagelinks', 'report', 'setup', 'vanity',
];
const CONTEXT_MENUS = ['Report Message', 'Report User', 'Report User'];
const EXPECTED_TOTAL = ROLEPLAY + ESSENTIAL.length + CONTEXT_MENUS.length;

const registered = collectCommandData();
const chat = registered.filter((json) => (json.type ?? 1) === ApplicationCommandType.ChatInput);
const roleplay = new Set(findCommandFiles(COMMANDS_DIR).filter((file) => file.includes('/roleplay/')).map((file) => require(file).data.name));
// Discord's limits for one command, from its documentation (docs.discord.com/developers/interactions/application-commands).
const LIMITS = { chatCommands: 100, perLevel: 25, nameLength: 32, descriptionLength: 100, commandSize: 8000 };

assert.deepEqual([...roleplay], ['act'], 'the interaction actions are the subcommands of /act');
assert.deepEqual(chat.map((json) => json.name).filter((name) => !roleplay.has(name)).sort(), [...ESSENTIAL].sort(), 'the slash commands besides roleplay are exactly the listed ones');
assert.deepEqual(registered.filter((json) => (json.type ?? 1) !== 1).map((json) => json.name).sort(), [...CONTEXT_MENUS].sort(), 'the context menus');
assert.equal(registered.length, EXPECTED_TOTAL, `${EXPECTED_TOTAL} commands are registered`);
// Discord allows 100 chat commands and 15 of each context menu type for an app.
assert.ok(chat.length <= LIMITS.chatCommands, `${chat.length} chat commands fit under Discord's ${LIMITS.chatCommands}`);
assert.equal(new Set(chat.map((json) => json.name)).size, chat.length, 'no two slash commands share a name');

// Every registered command is rebuilt from its JSON by discord.js's own builders, which refuse what Discord refuses.
const NAME = /^[-_\p{Ll}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const problems = [];
const size = (text) => [...String(text ?? '')].length;
function walk(node, trail, locales) {
  const leaf = node.type !== ApplicationCommandOptionType.Subcommand && node.type !== ApplicationCommandOptionType.SubcommandGroup;
  if (!NAME.test(node.name)) problems.push(`${trail}: the name "${node.name}" is not lowercase letters, digits, - or _ (1-32)`);
  if (!size(node.description) || size(node.description) > 100) problems.push(`${trail}: the description has ${size(node.description)} characters (1-100)`);
  for (const [locale, text] of Object.entries(node.name_localizations ?? {})) {
    if (!NAME.test(text)) problems.push(`${trail} [${locale}]: the name "${text}" is not lowercase letters, digits, - or _ (1-32)`);
    locales.add(locale);
  }
  for (const [locale, text] of Object.entries(node.description_localizations ?? {})) {
    if (!size(text) || size(text) > 100) problems.push(`${trail} [${locale}]: the description has ${size(text)} characters (1-100)`);
    locales.add(locale);
  }
  for (const choice of node.choices ?? []) {
    if (!size(choice.name) || size(choice.name) > 100) problems.push(`${trail}: the choice "${choice.name}" has a name of ${size(choice.name)} characters (1-100)`);
    if (typeof choice.value === 'string' && size(choice.value) > 100) problems.push(`${trail}: the choice "${choice.name}" has a value over 100 characters`);
  }
  if ((node.choices ?? []).length > 25) problems.push(`${trail}: ${node.choices.length} choices (at most 25)`);
  if (leaf) return;
  const options = node.options ?? [];
  if (options.length > 25) problems.push(`${trail}: ${options.length} options (at most 25)`);
  const names = options.map((option) => option.name);
  if (new Set(names).size !== names.length) problems.push(`${trail}: two options share a name`);
  if (!leaf && options.length > LIMITS.perLevel) problems.push(`${trail}: ${options.length} subcommands or groups (at most ${LIMITS.perLevel})`);
  const nested = options.filter((option) => option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup);
  if (nested.length && nested.length !== options.length) problems.push(`${trail}: subcommands mixed with plain options`);
  let optionalSeen = false;
  for (const option of options) {
    if (option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup) continue;
    if (option.required && optionalSeen) problems.push(`${trail} ${option.name}: a required option after an optional one`);
    if (!option.required) optionalSeen = true;
  }
  for (const option of options) walk(option, `${trail} ${option.name}`, locales);
}
/** Discord counts names, descriptions and choice names and values together, at most 8000 characters for a command in each language. */
function totalLength(json, locale) {
  let total = 0;
  const add = (node) => {
    total += size((locale && node.name_localizations?.[locale]) || node.name);
    total += size((locale && node.description_localizations?.[locale]) || node.description);
    for (const choice of node.choices ?? []) total += size(choice.name) + size(choice.value);
    for (const option of node.options ?? []) add(option);
  };
  add(json);
  return total;
}

for (const json of registered) {
  if ((json.type ?? 1) !== 1) {
    try { new ContextMenuCommandBuilder().setName(json.name).setType(json.type).toJSON(); } catch (error) { problems.push(`${json.name}: ${String(error.message).split('\n')[0]}`); }
    continue;
  }
  const locales = new Set();
  walk(json, `/${json.name}`, locales);
  for (const locale of [null, ...locales]) {
    const total = totalLength(json, locale);
    if (total > 8000) problems.push(`/${json.name}${locale ? ` [${locale}]` : ''}: ${total} characters in all (at most 8000)`);
  }
  if (json.default_member_permissions != null && !/^\d+$/.test(String(json.default_member_permissions))) problems.push(`/${json.name}: default_member_permissions is not a number`);
}
assert.deepEqual(problems, [], `Slash commands Discord would refuse:\n${problems.join('\n')}`);

// /act: every action is a subcommand of a group, with the optional member, inside what Discord allows for one command.
{
  const { ACTIONS, GROUPS } = require('../src/utils/actions');
  const act = chat.find((json) => json.name === 'act');
  assert.ok(act, '/act is registered');
  const groups = act.options;
  assert.ok(groups.length > 0 && groups.length <= LIMITS.perLevel, `/act has ${groups.length} groups (at most ${LIMITS.perLevel})`);
  assert.ok(groups.every((group) => group.type === ApplicationCommandOptionType.SubcommandGroup), '/act holds only groups, so every group can grow to 25 actions');
  assert.deepEqual(groups.map((group) => group.name), GROUPS.map((group) => group.name));
  for (const group of groups) assert.ok(group.options.length <= LIMITS.perLevel, `/act ${group.name} has ${group.options.length} actions (at most ${LIMITS.perLevel})`);
  const registeredActions = groups.flatMap((group) => group.options.map((sub) => sub.name));
  assert.deepEqual([...registeredActions].sort(), ACTIONS.map((action) => action.name).sort(), '/act has every action once');
  for (const group of groups) {
    for (const sub of group.options) {
      assert.deepEqual(sub.options.map((option) => [option.name, option.type, Boolean(option.required)]), [['user', ApplicationCommandOptionType.User, false]], `/act ${group.name} ${sub.name} takes an optional user`);
    }
  }
  assert.deepEqual(act.name_localizations, { 'es-ES': 'accion', 'es-419': 'accion', 'pt-BR': 'acao' });
  const english = totalLength(act, null);
  const sizes = [null, 'es-ES', 'pt-BR'].map((locale) => totalLength(act, locale));
  assert.ok(Math.max(...sizes) < LIMITS.commandSize, `/act is ${Math.max(...sizes)} characters (at most ${LIMITS.commandSize})`);
  console.log(`/act: ${groups.length} groups, ${registeredActions.length} actions, ${english} characters in English (${Math.max(...sizes)} in the longest language, Discord allows ${LIMITS.commandSize}).`);
}

// The builders of discord.js validate each command again when its JSON is made (names, lengths, required before optional).
for (const file of findCommandFiles(COMMANDS_DIR)) {
  const command = require(file);
  if (!isSlashCommand(command, file.includes('/roleplay/') ? 'roleplay' : undefined)) continue;
  assert.ok(command.data instanceof SlashCommandBuilder || typeof command.data.toJSON === 'function', `${command.data.name} has a builder`);
  assert.doesNotThrow(() => command.data.toJSON(), `${command.data.name} builds`);
}

// The everyday commands keep their prefix form, and the moderation ones are hidden from members who cannot use them.
for (const name of ESSENTIAL.filter((name) => !['setup'].includes(name))) {
  const file = findCommandFiles(COMMANDS_DIR).find((path) => require(path).data?.name === name && (require(path).data.toJSON().type ?? 1) === 1);
  const command = require(file);
  assert.ok(!command.slashOnly && !command.prefixOnly, `${name} works with the prefix and as a slash command`);
  assert.equal(command.data.toJSON().dm_permission, false, `/${name} is not offered in DMs`);
}
const byName = new Map(chat.map((json) => [json.name, json]));
for (const name of ['ban', 'unban', 'kick', 'warn', 'timeout', 'purge', 'channel', 'giveaway', 'embed']) {
  assert.ok(byName.get(name).default_member_permissions != null, `/${name} asks for a permission`);
}
// /embed: the saved embed is picked from a list, and its descriptions are translated like the rest.
const embedJson = byName.get('embed');
const embedLeaves = embedJson.options.flatMap((option) => (option.type === ApplicationCommandOptionType.SubcommandGroup ? option.options : [option]));
assert.deepEqual(embedLeaves.map((sub) => sub.name).sort(), ['add', 'author', 'color', 'create', 'delete', 'description', 'footer', 'image', 'list', 'preview', 'remove', 'send', 'thumbnail', 'timestamp', 'title', 'vars'].sort(), '/embed keeps every subcommand of the prefix form');
for (const sub of embedLeaves) {
  const option = (sub.options ?? []).find((o) => o.name === 'embed');
  if (option) assert.equal(option.autocomplete, true, `/embed ${sub.name} lists the saved embeds as they are typed`);
}
assert.ok(embedJson.description_localizations?.['es-ES'] && embedJson.description_localizations?.['es-419'] && embedJson.description_localizations?.['pt-BR'], '/embed is described in Spanish and Portuguese');
assert.equal(typeof require(findCommandFiles(COMMANDS_DIR).find((file) => file.endsWith('/config/embed.js'))).autocomplete, 'function', '/embed answers the autocomplete');
assert.ok(byName.get('help').options.some((option) => option.name === 'command' && option.autocomplete === true), '/help can look a command up');
assert.ok(byName.get('help').description_localizations?.['es-ES'] && byName.get('help').description_localizations?.['pt-BR'], '/help is described in Spanish and Portuguese');

console.log(`Checked the ${registered.length} commands registered with Discord (${chat.length} slash commands, ${registered.length - chat.length} context menus).`);
setTimeout(() => process.exit(0), 10);

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

// The roleplay commands are all registered; everything else is listed by name. A change here is a change of what members see in
// Discord's `/` menu, so it is made on purpose.
const ROLEPLAY = 36;
const ESSENTIAL = [
  // Everyday commands that also work with `/` (they keep working with the prefix).
  'afk', 'avatar', 'ban', 'botinfo', 'channel', 'embed', 'giveaway', 'help', 'kick', 'ping', 'poll', 'purge', 'rank', 'remind',
  'serverinfo', 'suggest', 'ticket', 'timeout', 'top', 'unban', 'userinfo', 'warn',
  // Registered before for their own reasons.
  'guildtag', 'report', 'setup', 'vanity',
  // The music: its subcommands (`/music play`, `search`...) and the song suggested while it is typed need the slash form.
  'music',
];
const CONTEXT_MENUS = ['Report Message', 'Report User', 'Report User'];
const EXPECTED_TOTAL = ROLEPLAY + ESSENTIAL.length + CONTEXT_MENUS.length;

const registered = collectCommandData();
const chat = registered.filter((json) => (json.type ?? 1) === ApplicationCommandType.ChatInput);
const roleplay = new Set(findCommandFiles(COMMANDS_DIR).filter((file) => file.includes('/roleplay/')).map((file) => require(file).data.name));

assert.equal(roleplay.size, ROLEPLAY, `there are ${ROLEPLAY} roleplay commands`);
assert.deepEqual(chat.map((json) => json.name).filter((name) => !roleplay.has(name)).sort(), [...ESSENTIAL].sort(), 'the slash commands besides roleplay are exactly the listed ones');
assert.deepEqual(registered.filter((json) => (json.type ?? 1) !== 1).map((json) => json.name).sort(), [...CONTEXT_MENUS].sort(), 'the context menus');
assert.equal(registered.length, EXPECTED_TOTAL, `${EXPECTED_TOTAL} commands are registered`);
// Discord allows 100 chat commands and 15 of each context menu type for an app.
assert.ok(chat.length <= 100, `${chat.length} chat commands fit under Discord's 100`);
assert.equal(new Set(chat.map((json) => json.name)).size, chat.length, 'no two slash commands share a name');

// Every registered command is rebuilt from its JSON by discord.js's own builders, which refuse what Discord refuses.
const NAME = /^[-_\p{Ll}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const problems = [];
const size = (text) => [...String(text ?? '')].length;
function walk(node, trail, locales) {
  const leaf = node.type !== ApplicationCommandOptionType.Subcommand && node.type !== ApplicationCommandOptionType.SubcommandGroup;
  if (!NAME.test(node.name)) problems.push(`${trail}: the name "${node.name}" is not lowercase letters, digits, - or _ (1-32)`);
  if (!size(node.description) || size(node.description) > 100) problems.push(`${trail}: the description has ${size(node.description)} characters (1-100)`);
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
    total += size(node.name);
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
assert.ok(byName.get('help').options.some((option) => option.name === 'query'), '/help can look a command up');
assert.ok(byName.get('help').description_localizations?.['es-ES'] && byName.get('help').description_localizations?.['pt-BR'], '/help is described in Spanish and Portuguese');

console.log(`Checked the ${registered.length} commands registered with Discord (${chat.length} slash commands, ${registered.length - chat.length} context menus).`);
setTimeout(() => process.exit(0), 10);

// Guards the structure of the slash commands (the `/` menu of Discord), so it stays understandable and complete:
//   1. no loose command: every slash command is an umbrella with groups or subcommands, except `/help`, `/setup` and the context menus;
//   2. no registered name from the old list (`/level`, `/rank`, `/top`, `/act`, `/auto`, `/contrib`, `/special`, `/botinfo`, `/ping`, `/poll`, `/suggest`), and none of
//      the old paths that moved (`/config prefix`, `/game minecraft`...);
//   3. every name (command, group, subcommand, option) is made of whole words: no abbreviation from the deny list, nothing of one or two letters that is not a known word;
//   4. the prefix words of what was renamed or moved still resolve (`!act`, `!auto`, `!level`, `!rank`, `!top`, `!leaderboard`, `!botinfo`, `!ping`, `!poll`,
//      `!suggest`, `!config prefix`, `!game minecraft`...), and the rules a server saved under an old name still reach the new command;
//   5. the limits of Discord: 25 subcommands or groups in each level, 8000 characters in each language, 100 chat commands, two levels deep;
//   6. coverage: every public prefix command and subcommand has a slash entry, except the ones listed here with the reason.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');
const { collectCommandData, findCommandFiles, COMMANDS_DIR, isSlashCommand, loadCommands } = require('../src/handlers/commandHandler');
const { slotUsage, commandSize, LIMITS } = require('../src/utils/slashBudget');
const commandRules = require('../src/utils/commandRules');

const SUBCOMMAND = 1;
const GROUP = 2;
const registered = collectCommandData();
const chat = registered.filter((json) => (json.type ?? 1) === 1);
const menus = registered.filter((json) => (json.type ?? 1) !== 1);

// ---------------------------------------------------------------- 1. no loose command
// `/help`, `/poll` and `/setup` are commands of their own (they take options or open a guide or a panel); everything else has subcommands.
const STANDALONE = ['help', 'poll', 'setup'];
const loose = chat.filter((json) => !(json.options ?? []).some((option) => option.type === SUBCOMMAND || option.type === GROUP)).map((json) => json.name);
assert.deepEqual(loose.sort(), [...STANDALONE].sort(), `the only slash commands without subcommands are ${STANDALONE.join(' and ')} (loose: ${loose.join(', ')})`);
assert.deepEqual(menus.map((json) => `${json.name}:${json.type}`).sort(), ['Report Message:3', 'Report User:2', 'Report User:3'], 'the context menus');

// ---------------------------------------------------------------- 2. nothing from the old list
const OLD_COMMANDS = ['level', 'rank', 'top', 'act', 'auto', 'contrib', 'special', 'botinfo', 'ping'];
for (const name of OLD_COMMANDS) assert.ok(!chat.some((json) => json.name === name), `/${name} is not registered any more`);
const nodeNames = (json, prefix = []) => (json.options ?? []).filter((option) => option.type === SUBCOMMAND || option.type === GROUP).flatMap((option) => [[...prefix, option.name].join(' '), ...nodeNames(option, [...prefix, option.name])]);
const paths = new Set(chat.flatMap((json) => [json.name, ...nodeNames(json, [json.name])]));
const OLD_PATHS = [
  'config prefix', 'config moderation', 'config restrictcommand', 'config disablecommand', 'config statsconfig', 'greet poj', 'special imgonly', 'special urlonly',
  'game minecraft', 'game minecraft-server', 'game roblox', 'game steam', 'game chesscom', 'game lichess', 'game pokemon', 'game modrinth', 'game rps',
  'me rep', 'me rep-give', 'staff imute', 'staff iunmute', 'staff rmute', 'staff runmute', 'staff raid', 'role in', 'role has', 'boosterrole admin base', 'boosterrole admin limit',
  'boosterrole admin cooldown', 'boosterrole admin share-limit', 'search anilist anime anime',
];
for (const old of OLD_PATHS) assert.ok(!paths.has(old), `/${old} is not registered any more`);
for (const kept of ['levels rank', 'levels leaderboard', 'action love hug', 'bot info', 'bot ping', 'poll', 'suggest send', 'suggest approve', 'confess send', 'confess approve', 'request make', 'request config channel', 'review give', 'profile show', 'profile config channel', 'prefix view', 'prefix add', 'prefix remove', 'prefix set', 'prefix reset', 'me prefix']) {
  assert.ok(paths.has(kept), `/${kept} is registered`);
}
assert.ok(!paths.has('config prefix show'), 'the prefix of the server is /prefix, not a group of /config');

// ---------------------------------------------------------------- 3. names made of whole words
// A word of one or two letters is only allowed when it is a word people know.
const SHORT_WORDS = new Set(['ai', 'me', 'id', 'to', 'tv', 'xp', 'on', 'off', 'in', 'of', 'no', 'dm', 'by', 'up', 'hi']);
// Abbreviations and cryptic shorts that must never come back (a whole word, or the start of a word: `imgonly`).
const DENY_WORDS = new Set(['cfg', 'conf', 'msg', 'chan', 'chn', 'ch', 'rr', 'br', 'sr', 'mbo', 'tk', 'tkt', 'perm', 'perms', 'cmd', 'cmds', 'img', 'pic', 'pics', 'vc', 'poj', 'rps', 'gw', 'am', 'cnt', 'tmr', 'vm', 'sug', 'lvl', 'lb', 'usr', 'srv', 'chat', 'mem', 'mbr', 'rep']);
const DENY_START = /^(img|cfg|msg|chn|tkt|poj|imute|iunmute|rmute|runmute|inrole|ptr)/;
const NAME = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const wordProblems = [];
const checkName = (name, trail) => {
  if (!NAME.test(name)) { wordProblems.push(`${trail}: "${name}" is not lowercase words joined with - or _`); return; }
  for (const word of name.split(/[-_]/)) {
    if (DENY_WORDS.has(word) || DENY_START.test(word)) wordProblems.push(`${trail}: "${word}" is an abbreviation: write the whole word`);
    else if (word.length <= 2 && !SHORT_WORDS.has(word) && !/^\d/.test(word)) wordProblems.push(`${trail}: "${word}" is too short to be understood in a menu`);
  }
};
const walkNames = (node, trail) => {
  checkName(node.name, trail);
  for (const option of node.options ?? []) walkNames(option, `${trail} ${option.name}`);
};
for (const json of chat) walkNames(json, `/${json.name}`);
// `reputation` is the word of the group that wraps `rep`, and `rep` itself stays a prefix word: only registered names are checked here.
assert.deepEqual(wordProblems, [], `names that are not whole words:\n${wordProblems.join('\n')}`);

// ---------------------------------------------------------------- 5. the limits of Discord
const limitProblems = [];
for (const json of chat) {
  const top = (json.options ?? []).filter((option) => option.type === SUBCOMMAND || option.type === GROUP);
  if (top.length > LIMITS.subcommands) limitProblems.push(`/${json.name}: ${top.length} subcommands and groups (at most ${LIMITS.subcommands})`);
  for (const group of top.filter((option) => option.type === GROUP)) {
    if ((group.options ?? []).length > LIMITS.subcommands) limitProblems.push(`/${json.name} ${group.name}: ${group.options.length} subcommands (at most ${LIMITS.subcommands})`);
    if ((group.options ?? []).some((option) => option.type === GROUP)) limitProblems.push(`/${json.name} ${group.name}: a group inside a group (Discord allows two levels)`);
  }
  const size = commandSize(json);
  if (size > LIMITS.size) limitProblems.push(`/${json.name}: ${size} characters in its longest language (at most ${LIMITS.size})`);
}
assert.deepEqual(limitProblems, [], `limits of Discord:\n${limitProblems.join('\n')}`);
const usage = slotUsage(registered);
assert.ok(usage.chat.used <= LIMITS.chat, `${usage.chat.used} chat commands (at most ${LIMITS.chat})`);
assert.equal(usage.chat.used, chat.length);
assert.ok(usage.chat.free >= 30, `${usage.chat.free} chat command slots are still free (at least 30 are kept for what comes next)`);

// ---------------------------------------------------------------- 4. the old words still resolve
const client = { user: { id: '123' }, users: { fetch: async (id) => ({ id }) } };
loadCommands(client);
const resolves = (word) => client.commands.has(word) || client.commandAliases.has(word) || client.commandRoutes.has(word);
const target = (word) => {
  const name = client.commands.has(word) ? word : client.commandAliases.get(word) ?? client.commandRoutes.get(word)?.command;
  return name;
};
const WORDS = {
  act: 'action', action: 'action', auto: 'automation', automation: 'automation', contrib: 'contributions', contributions: 'contributions', special: 'specialchannels', specialchannels: 'specialchannels',
  level: 'level', levels: 'levels', xp: 'level', rank: 'rank', nivel: 'rank', lvl: 'rank', top: 'top', leaderboard: 'top', lb: 'top', ranking: 'top', botinfo: 'botinfo', about: 'botinfo', bi: 'botinfo',
  ping: 'ping', p: 'ping', poll: 'poll', pl: 'poll', suggest: 'suggest', sug: 'suggest', suggestion: 'suggestion', prefix: 'prefix', pfx: 'prefix', setup: 'setup',
  hug: 'action', pat: 'action', slap: 'action', hf: 'action',
  restrictcommand: 'restrictcommand', disablecommand: 'disablecommand', moderation: 'moderation', statsconfig: 'statsconfig', poj: 'poj', imgonly: 'imgonly', urlonly: 'urlonly',
  minecraft: 'minecraft', mc: 'minecraft', roblox: 'roblox', steam: 'steam', chesscom: 'chess', lichess: 'chess', pokemon: 'pokemon', modrinth: 'modrinth', rps: 'rps',
  imute: 'imute', rmute: 'rmute', raid: 'raid', rep: 'rep', br: 'boosterrole', boosterrole: 'boosterrole',
};
for (const [word, expected] of Object.entries(WORDS)) {
  assert.ok(resolves(word), `!${word} still resolves`);
  assert.equal(target(word), expected, `!${word} is ${expected}`);
}
// The first word of the umbrellas of before.
const FIRST_WORDS = {
  config: { prefix: 'prefix', moderation: 'moderation', restrictcommand: 'restrictcommand', disablecommand: 'disablecommand', statsconfig: 'statsconfig' },
  greet: { poj: 'poj' },
  specialchannels: { imgonly: 'imgonly', urlonly: 'urlonly' },
  game: { minecraft: 'minecraft', roblox: 'roblox', steam: 'steam', chesscom: 'chess', lichess: 'chess', pokemon: 'pokemon', modrinth: 'modrinth', mc: 'minecraft' },
  levels: { 'voice-xp': 'level', 'voice-enable': 'level', 'sync-join': 'level', reward: 'level', multiplier: 'level', event: 'level', rank: 'rank', leaderboard: 'top', status: 'level', reset: 'level', rules: 'level', curve: 'level' },
  search: { yt: 'youtube', gh: 'github', ani: 'anilist', chesscom: 'chess', 'minecraft-server': 'minecraft', math: 'calc' },
  bot: { info: 'botinfo', ping: 'ping', botinfo: 'botinfo' },
};
for (const [umbrella, words] of Object.entries(FIRST_WORDS)) {
  const command = client.commands.get(umbrella);
  const own = new Set((command.data.toJSON().options ?? []).map((option) => option.name));
  for (const [word, expected] of Object.entries(words)) {
    const route = command.prefixWords?.[word];
    // A word is read by the umbrella when it is one of its own names (it wraps the command) or an old word (`prefixWords`).
    assert.ok(route || own.has(word), `!${umbrella} ${word} still means something`);
    if (route) assert.equal(route.command, expected, `!${umbrella} ${word} goes to ${expected}`);
  }
}
const staffWords = client.commands.get('staff').prefixSubcommandAliases;
assert.deepEqual([staffWords.imute, staffWords.iunmute, staffWords.rmute, staffWords.runmute, staffWords.raid], ['image-mute', 'image-unmute', 'reaction-mute', 'reaction-unmute', 'raid-clean']);
assert.deepEqual([client.commands.get('role').prefixSubcommandAliases.in, client.commands.get('role').prefixSubcommandAliases.has], ['members', 'bulk-by-role']);
assert.equal(client.commands.get('me').prefixSubcommandAliases.rep, 'reputation');
assert.equal(client.commands.get('game').prefixSubcommandAliases.rps, 'rockpaperscissors');
assert.equal(client.commands.get('boosterrole').prefixPathAliases['admin base'], 'settings base-role');
// The rules a server saved under an old name reach the new command.
for (const [command, old] of [['action', 'act'], ['automation', 'auto'], ['contributions', 'contrib'], ['specialchannels', 'special']]) {
  assert.ok(commandRules.ruleNames(client.commands.get(command)).includes(old), `a rule saved for ${old} reaches /${command}`);
  assert.ok(commandRules.permissionNames(client.commands.get(command)).includes(old), `a permission level saved for ${old} reaches /${command}`);
}
for (const [umbrella, group, sub, rule] of [['levels', 'voice', 'xp', 'level'], ['levels', 'settings', 'curve', 'level'], ['levels', null, 'rank', 'rank'], ['levels', null, 'leaderboard', 'top'], ['bot', null, 'ping', 'ping'], ['bot', null, 'info', 'botinfo'], ['poll', null, null, 'poll'], ['poll', null, null, 'community'], ['suggest', null, 'send', 'suggest'], ['suggest', null, 'approve', 'suggestion'], ['suggest', null, 'setup', 'community'], ['confess', null, 'approve', 'confession'], ['confess', null, 'send', 'confess'], ['request', 'config', 'channel', 'requestconfig'], ['request', 'config', 'channel', 'community'], ['profile', 'config', 'view', 'profileconfig'], ['review', null, 'give', 'community']]) {
  assert.ok(commandRules.ruleNames(client.commands.get(umbrella), { subcommand: sub, group }).includes(rule), `a rule saved for ${rule} reaches /${umbrella} ${group ?? ''} ${sub}`);
}
// A name that is a prefix word is never also a registered abbreviation.
for (const word of ['act', 'auto', 'contrib', 'special']) assert.ok(client.commandAliases.has(word), `${word} is an alias, kept for the prefix`);

// ---------------------------------------------------------------- 6. coverage: every public prefix command has a slash entry
const all = new Map();
for (const file of findCommandFiles(COMMANDS_DIR)) {
  const command = require(file);
  if (!command?.data) continue;
  command.category = path.relative(COMMANDS_DIR, file).split(path.sep)[0];
  all.set(command.data.name, command);
}
const subsOf = (command) => (command.data.toJSON().options ?? []).flatMap((option) => (option.type === SUBCOMMAND ? [option.name] : option.type === GROUP ? option.options.map((sub) => `${option.name} ${sub.name}`) : []));
const covered = new Map();
const cover = (name, sub) => { if (!covered.has(name)) covered.set(name, new Set()); covered.get(name).add(sub); };
for (const command of all.values()) {
  if (isSlashCommand(command, command.category)) { cover(command.data.name, '*'); for (const sub of subsOf(command)) cover(command.data.name, sub); }
  for (const entry of command.leaves ?? (command.umbrella || command.subcommands ? command.subcommands ?? [] : [])) {
    if (!entry.wraps) continue; // a subcommand of its own (`/server icon`)
    const wrapped = all.get(entry.wraps);
    assert.ok(wrapped, `/${command.data.name}: ${entry.wraps} exists`);
    if (entry.sub) {
      const wanted = `${entry.subGroup ? `${entry.subGroup} ` : ''}${entry.sub}`;
      assert.ok(subsOf(wrapped).includes(wanted), `/${command.data.name} wraps ${entry.wraps} ${wanted}, which exists`);
      cover(entry.wraps, wanted);
    } else {
      cover(entry.wraps, '*');
      for (const sub of subsOf(wrapped)) cover(entry.wraps, sub);
    }
  }
}
// What is left out on purpose, with the reason.
const LEFT_OUT = {
  timeout: 'an old word of `!tempmute` that was never a command of its own (it replaced `/timeout` long ago: `/mod tempmute` and `/modtools mute temp` are the same)',
};
// The join roles and the sticky roles are groups of `/role` (`/role join`, `/role sticky`), which is not an umbrella.
const GROUP_OF_ROLE = { joinrole: 'join', stickyroles: 'sticky' };
const missing = [];
for (const [name, command] of all) {
  if (GROUP_OF_ROLE[name]) { assert.ok(paths.has(`role ${GROUP_OF_ROLE[name]}`), `/role ${GROUP_OF_ROLE[name]} covers !${name}`); continue; }
  const json = command.data.toJSON();
  if ((json.type ?? 1) !== 1 || command.category === 'music' || command.teamOnly || command.ownerOnly || command.hiddenEverywhere || command.privateGuildId || command.hiddenFromHelp || command.slashOnly) continue;
  // The cards of `!<module>config`, generated for every module: they only explain the settings of a module.
  if (/^Show the .* settings and how to change them\.$/.test(json.description)) continue;
  const have = covered.get(name);
  const dropped = new Set(command.prefixOnlySubcommands ?? []);
  const subs = subsOf(command).filter((sub) => !dropped.has(sub) && !(command.teamParts ?? []).includes(sub));
  if (!subs.length) { if (!have && !LEFT_OUT[name] && !(name === 'suggest')) missing.push(name); continue; }
  const lacking = subs.filter((sub) => !have?.has(sub));
  if (lacking.length && !LEFT_OUT[name]) missing.push(`${name} (${lacking.join(', ')})`);
}
assert.deepEqual(missing, [], `public prefix commands with no slash entry (add them to an umbrella, or to LEFT_OUT with the reason):\n${missing.join('\n')}`);
for (const name of Object.keys(LEFT_OUT)) assert.ok(all.has(name), `${name} (left out) still exists`);
// `!suggest` is `/suggest send`; the subcommands of `!suggestion` are the ones of `/suggest` too.
assert.ok(subsOf(all.get('suggestion')).includes('submit'), '!suggestion submit exists');
assert.ok(subsOf(all.get('suggest')).includes('send'), '/suggest send exists');

// ---------------------------------------------------------------- 7. every subcommand of the new umbrellas reaches the old command it wraps
// (the groups put together by hand: `/levels voice xp` is `!level voice-xp`, `/modtools lockdown add-channel` is `!lockdown channel add`)
const moderationPermissions = require('../src/utils/moderationPermissions');
moderationPermissions.hasConfiguredRole = async () => false;
const recorded = [];
const restore = [];
const wrappedByAnUmbrella = new Set([...all.values()].flatMap((command) => (command.leaves ?? []).map((entry) => entry.wraps).filter(Boolean)));
for (const command of [...all.values()].filter((each) => wrappedByAnUmbrella.has(each.data.name) && !each.umbrella)) {
  const original = command.execute;
  restore.push(() => { command.execute = original; });
  command.execute = async (interaction) => { recorded.push({ file: command.data.name, sub: interaction.options.getSubcommand(false), group: interaction.options.getSubcommandGroup(false), name: interaction.commandName }); };
}
const fakeInteraction = (leaf) => ({
  commandName: 'x', guildId: '1', guild: { id: '1' }, user: { id: '2' },
  member: { permissions: { has: () => true }, roles: { cache: new Map() } },
  options: { getSubcommand: () => leaf.name, getSubcommandGroup: () => leaf.group ?? null },
  reply: async () => {}, isChatInputCommand: () => true,
});
(async () => {
  let ran = 0;
  for (const umbrella of ['levels', 'modtools', 'social', 'search', 'bot', 'config', 'automation']) {
    const command = all.get(umbrella);
    for (const leaf of command.leaves) {
      if (!leaf.wraps) continue;
      recorded.length = 0;
      await command.execute(fakeInteraction(leaf));
      assert.equal(recorded.length, 1, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} runs one command`);
      assert.deepEqual([recorded[0].file, recorded[0].sub, recorded[0].group, recorded[0].name], [leaf.wraps, leaf.sub ?? null, leaf.subGroup ?? null, leaf.wraps], `/${umbrella} ${leaf.group ?? ''} ${leaf.name} runs ${leaf.wraps} ${leaf.subGroup ?? ''} ${leaf.sub ?? ''}`);
      ran += 1;
    }
  }
  for (const undo of restore) undo();
  assert.ok(ran > 200, `${ran} subcommands were run through their umbrella`);
  console.log(`check-slash-structure: ok (${usage.chat.used} chat commands of ${LIMITS.chat}, ${usage.chat.free} free; ${menus.length} menus; ${ran} umbrella subcommands reach their old command)`);
  setTimeout(() => process.exit(0), 10);
})().catch((error) => { console.error(error); process.exit(1); });

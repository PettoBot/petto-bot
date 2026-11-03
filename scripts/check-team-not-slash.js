// A permanent guard: NOTHING that only the owner or the Petto team may use is a slash command. Those actions are hidden prefix-only tools (`!premiumadmin`, `!guilddebug`,
// `!channel create`, `!am <token>`...): Discord shows every registered slash command and subcommand to everybody in the `/` menu, so a leaf that "refuses at runtime" is still
// a leak. This check:
//   1. builds the JSON that is REGISTERED with Discord (global and private-guild, as deploy-commands.js does, with `prefixOnlySubcommands` taken out and the umbrellas opened)
//      and lists every leaf;
//   2. fails when one of the explicit TEAM_ONLY_COMMANDS / TEAM_ONLY_LEAVES (the full list of team-only actions that were found, in every place they could show) is registered;
//   3. fails when a loaded command that is registered carries the flags of a team tool (`teamOnly`, `ownerOnly`, `hiddenEverywhere`, `team`, `privateGuildId`), or when a
//      team part (`teamParts`) of a registered command is also a registered leaf;
//   4. scans the SOURCE of every command that is registered (and of every command an umbrella wraps) for the runtime gates of the team (isOwner, config.ownerId,
//      config.developerIds, PETTO_OWNER_ID / PETTO_DEVELOPER_IDS, isTeam, isPettoOperator, teamOnly, ownerOnly...) and fails with a file:line list when one is not in the
//      ALLOWED list below with a written reason (a gate that is not a team action: a member-facing line, a switch that is open by default, the owner of the SERVER...);
//   5. proves it can fail: the same logic runs on the registered JSON and the sources of the OLD state (where these leaves were slash commands) and must report them.
// To add a team-only action: write its prefix-only tool, add it to TEAM_ONLY_LEAVES, and never to a slash command.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';

const root = path.join(__dirname, '..');
const { collectCommandData, collectPrivateGuildCommandData, findCommandFiles } = require('../src/handlers/commandHandler');

const SUBCOMMAND = 1;
const GROUP = 2;

/** Every command that only the team (or only the owner) may use: none of them is a command, group or leaf of any registered slash command. */
const TEAM_ONLY_COMMANDS = ['premiumadmin', 'guilddebug', 'blacklist', 'leaveguild', 'guildsend', 'botstatus', 'slots', 'team', 'teamhelp'];

/** Every team-only action inside a command that members DO see (a path from the end of the leaf: it is also looked for inside the umbrellas, `bot premium grant`). */
const TEAM_ONLY_LEAVES = [
  ['premium', 'grant'], ['premium', 'assign'], ['premium', 'unassign'], ['premium', 'revoke'], // the owner actions of Premium (also `/bot premium ...`)
  ['channel', 'create'], // creating channels: the team only
  ['automod', 'control'], // the hidden control of the official AutoMod
  ['guilddebug', 'info'], ['guilddebug', 'send'], ['guilddebug', 'dm-owner'], // the diagnostics of a server
];

/**
 * The runtime gates that decide who is in the team. A line of a registered command that has one is a failure unless it is listed here with the reason it is not a team
 * action of the slash command. `requires` (optional): what the command must declare for the gate to be allowed (it must be `prefixOnlySubcommands`).
 */
const GATES = [
  /\bisDeveloper\b/, /\bisOwner\b/, /\bPETTO_OWNER_ID\b/, /\bPETTO_DEVELOPER_IDS\b/, /\bconfig\.(ownerId|ownerIds|developerIds)\b/, /\bisTeam\b/, /\bisPettoOperator\b/,
  /\bteamOnly\b/, /\bownerOnly\b/, /\bcanCreateChannels\b/, /\bcanUse(Feeds|Quests|Rollouts)\b/,
];
const ALLOWED = [
  { file: 'src/commands/info/premium.js', match: /isOwner|config\.ownerId/, reason: 'the owner may read the Premium status of anybody and a member only their own: a member-facing look, not an action of the team' },
  { file: 'src/commands/moderation/channel.js', match: /canCreateChannels|config\.(ownerId|developerIds)/, reason: 'the gate of `create`, which is a prefix-only subcommand (not in the slash JSON)', requires: ['create'] },
  { file: 'src/commands/automation/automod.js', match: /isPettoOperator/, reason: 'the gate of the hidden `control` path, which is a prefix-only subcommand (not in the slash JSON)', requires: ['control'] },
  { file: 'src/commands/utility/help.js', match: /isPettoOperator/, reason: 'only widens what the autocomplete and the answer of /help list for the team: no leaf of its own' },
  { file: 'src/commands/automation/voicemaster.js', match: /voicemaster\.ownerOnly/, reason: 'the owner of the temporary voice channel (the member who made it), not the Petto team' },
  { file: 'src/commands/config/antinuke.js', match: /ownerOnly/, reason: 'the owner of the SERVER (and its owner-only switch), not the Petto team' },
  { file: 'src/commands/config/feed.js', match: /canUseFeeds/, reason: 'open to every server by default; FEEDS_PUBLIC=false closes it for a time, it is not gated to the team regardless' },
  { file: 'src/commands/utility/quests.js', match: /canUseQuests/, reason: 'open to every server by default; QUESTS_PUBLIC=false closes it for a time (the API of the quests), it is not gated to the team regardless' },
  { file: 'src/commands/utility/rollouts.js', match: /canUseRollouts/, reason: 'open to every server by default; ROLLOUTS_PUBLIC=false closes it for a time, it is not gated to the team regardless' },
];

/** `[ 'bot premium status', ... ]` as arrays of names: every leaf of a command JSON (a command with no subcommand is its own leaf). */
function leavesOf(json, prefix = []) {
  const here = [...prefix, json.name];
  const subs = (json.options ?? []).filter((option) => option.type === SUBCOMMAND || option.type === GROUP);
  return subs.length ? subs.flatMap((option) => leavesOf(option, here)) : [here];
}

/** Every node name of a command JSON with its path (commands, groups and leaves). */
function nodesOf(json, prefix = []) {
  const here = [...prefix, json.name];
  return [here, ...(json.options ?? []).filter((option) => option.type === SUBCOMMAND || option.type === GROUP).flatMap((option) => nodesOf(option, here))];
}

const endsWith = (list, tail) => tail.every((word, at) => list[list.length - tail.length + at] === word) && list.length >= tail.length;

/** What of the team is in a registered JSON (a list of command JSONs): the names that must never be there. */
function leaksInRegistered(registered) {
  const found = [];
  for (const json of registered) {
    // A team tool is a COMMAND (the top level); `/ticket blacklist` is another thing that only has the same word.
    if (TEAM_ONLY_COMMANDS.includes(json.name)) found.push(`/${json.name}: "${json.name}" is a team tool`);
    for (const leaf of nodesOf(json)) {
      for (const tail of TEAM_ONLY_LEAVES) if (endsWith(leaf, tail)) found.push(`/${leaf.join(' ')}: a team-only action (${tail.join(' ')})`);
    }
  }
  return [...new Set(found)];
}

/** The lines of a source with a runtime gate of the team: `[{ line, text, gate }]`; comments are not code and are skipped. */
function gateLines(source) {
  const hits = [];
  source.split('\n').forEach((raw, at) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const code = raw.replace(/\s\/\/.*$/, '');
    const gate = GATES.find((pattern) => pattern.test(code));
    if (gate) hits.push({ line: at + 1, text: trimmed, gate: String(gate) });
  });
  return hits;
}

/** The gates of a file that are not allowed: `file:line text`. `command`: the loaded module (for `requires`). `allowed`: which entries were used (to find stale ones). */
function unallowedGates(file, source, command, allowed, used = new Set()) {
  return gateLines(source).filter((hit) => {
    const entry = allowed.find((each) => each.file === file && each.match.test(hit.text));
    if (!entry) return true;
    if (entry.requires && !entry.requires.every((sub) => (command?.prefixOnlySubcommands ?? []).includes(sub))) return true;
    used.add(entry);
    return false;
  }).map((hit) => `${file}:${hit.line} ${hit.text.slice(0, 140)}`);
}

/** The files whose source counts: every command that is registered, and every command an umbrella wraps (`wraps: 'name'`). */
function filesToScan(commandsByFile, registeredNames) {
  const byName = new Map([...commandsByFile].map(([file, command]) => [path.basename(file, '.js'), file]));
  const files = new Set();
  for (const [file, command] of commandsByFile) if (registeredNames.has(command.data.name)) files.add(file);
  for (const file of [...files]) {
    for (const [, wrapped] of fs.readFileSync(file, 'utf8').matchAll(/\bwraps:\s*'([\w-]+)'/g)) if (byName.has(wrapped)) files.add(byName.get(wrapped));
  }
  return [...files];
}

(async () => {
  // ---------------------------------------------------------------- the registered JSON, global and private
  const files = findCommandFiles(path.join(root, 'src', 'commands'));
  const commandsByFile = new Map(files.map((file) => [file, require(file)]).filter(([, command]) => command?.data));
  const global = collectCommandData();
  const privateData = collectPrivateGuildCommandData().map((entry) => entry.data);
  const registered = [...global, ...privateData];
  const registeredNames = new Set(registered.map((json) => json.name));
  const leaves = registered.flatMap((json) => leavesOf(json));
  assert.ok(registered.length >= 60 && leaves.length > 500, `the registered commands are read (${registered.length} commands, ${leaves.length} leaves)`);
  assert.equal(privateData.length, 0, 'no command is registered in a private server only: the team tools are not slash commands at all');

  // ---------------------------------------------------------------- 1. the explicit list of team-only actions is not registered
  assert.deepEqual(leaksInRegistered(registered), [], 'no team-only command, group or leaf is registered as a slash command');
  // the replacements exist as prefix-only tools, so the list cannot be emptied by deleting the tool
  for (const name of TEAM_ONLY_COMMANDS.filter((each) => each !== 'teamhelp')) {
    const command = [...commandsByFile.values()].find((each) => each.data.name === name);
    assert.ok(command, `the team tool ${name} exists`);
    assert.ok(command.prefixOnly && command.teamOnly && !registeredNames.has(name), `${name} is prefix only and team only`);
  }
  // the actions that stay inside a command members use: prefix-only subcommands that really exist in the builder and are not in the slash JSON
  for (const [name, sub] of TEAM_ONLY_LEAVES.filter(([name]) => ['channel', 'automod'].includes(name))) {
    const command = [...commandsByFile.values()].find((each) => each.data.name === name);
    assert.ok(command.prefixOnlySubcommands?.includes(sub), `${name} declares ${sub} as prefixOnlySubcommands`);
    assert.ok(command.data.toJSON().options.some((option) => option.name === sub), `${name} ${sub} still exists for the prefix`);
    assert.ok(!(registered.find((json) => json.name === name)?.options ?? []).some((option) => option.name === sub), `${name} ${sub} is not in the registered JSON`);
  }

  // ---------------------------------------------------------------- 2. no registered command carries the flags of a team tool
  for (const [file, command] of commandsByFile) {
    if (!registeredNames.has(command.data.name)) continue;
    const label = path.relative(root, file);
    for (const flag of ['teamOnly', 'ownerOnly', 'hiddenEverywhere', 'team', 'privateGuildId']) assert.ok(!command[flag], `${label}: a registered slash command does not carry ${flag}`);
    for (const part of command.teamParts ?? []) {
      const words = part.usage.replace(/^!/, '').split(/\s+/).filter((word) => /^[a-z][a-z-]*$/.test(word));
      const asked = [command.data.name, ...words.slice(1, 2)];
      const hit = leaves.find((leaf) => words.length > 1 && endsWith(leaf, asked));
      assert.ok(!hit, `${label}: the team part "${part.usage}" is a registered leaf (/${(hit ?? []).join(' ')})`);
    }
  }
  // every team tool and every flagged command is out of the registered set
  for (const command of commandsByFile.values()) {
    if (command.teamOnly || command.team || command.hiddenEverywhere) assert.ok(!registeredNames.has(command.data.name), `${command.data.name} is a team tool and is not registered`);
  }

  // ---------------------------------------------------------------- 3. the sources of what is registered have no team gate that is not allowed
  const used = new Set();
  const failures = [];
  for (const file of filesToScan(commandsByFile, registeredNames)) {
    const label = path.relative(root, file).split(path.sep).join('/');
    failures.push(...unallowedGates(label, fs.readFileSync(file, 'utf8'), commandsByFile.get(file), ALLOWED, used));
  }
  assert.deepEqual(failures, [], `a registered slash command has a runtime gate of the team (move that action to a prefix-only tool, or allow it above with a reason):\n  ${failures.join('\n  ')}`);
  const stale = ALLOWED.filter((entry) => !used.has(entry));
  assert.deepEqual(stale.map((entry) => `${entry.file} ${entry.match}`), [], 'every allowed gate is still in use (remove the entries that are not)');
  for (const entry of ALLOWED) assert.ok(entry.reason && entry.reason.length > 20, `${entry.file}: the allowed gate has a written reason`);

  // ---------------------------------------------------------------- 4. the guard can FAIL: the old state (where these were slash commands) is reported
  const node = (name, type, options = []) => ({ name, type, options });
  const oldRegistered = [
    { name: 'channel', options: [node('create', SUBCOMMAND), node('lock', SUBCOMMAND)] },
    { name: 'bot', options: [node('premium', GROUP, [node('status', SUBCOMMAND), node('grant', SUBCOMMAND), node('assign', SUBCOMMAND), node('unassign', SUBCOMMAND), node('revoke', SUBCOMMAND)])] },
    { name: 'automod', options: [node('control', SUBCOMMAND)] },
    { name: 'guilddebug', options: [node('info', SUBCOMMAND), node('send', SUBCOMMAND), node('dm-owner', SUBCOMMAND)] },
  ];
  const oldLeaks = leaksInRegistered(oldRegistered);
  for (const wanted of ['/channel create', '/bot premium grant', '/bot premium assign', '/bot premium unassign', '/bot premium revoke', '/automod control', '/guilddebug', '/guilddebug dm-owner']) {
    assert.ok(oldLeaks.some((leak) => leak.startsWith(wanted)), `the guard reports ${wanted} when it is registered`);
  }
  assert.ok(!oldLeaks.some((leak) => leak.startsWith('/channel lock')), 'and it does not report an ordinary leaf');
  assert.ok(leaksInRegistered([{ name: 'mod', options: [node('premium', GROUP, [node('grant', SUBCOMMAND)])] }]).length, 'it also finds a team action inside any umbrella');
  const oldSource = ["const isOwner = (id) => id === config.ownerId;", "if (!isOwner(interaction)) return replyError(interaction, t(lang, 'info.premium.ownerOnly'));", '// isOwner in a comment is not code', "const { isTeam } = require('../../utils/teamTools');"].join('\n');
  assert.equal(unallowedGates('src/commands/info/fake.js', oldSource, {}, ALLOWED).length, 3, 'the scan reports the gates in the source of a registered command (and not the comment)');
  assert.equal(unallowedGates('src/commands/moderation/channel.js', 'if (!canCreateChannels(id)) return;', {}, ALLOWED).length, 1, 'an allowed gate is not allowed when the subcommand is NOT prefix only');
  assert.equal(unallowedGates('src/commands/moderation/channel.js', 'if (!canCreateChannels(id)) return;', { prefixOnlySubcommands: ['create'] }, ALLOWED).length, 0, 'and it is when it is');

  console.log(`check-team-not-slash: ok (${registered.length} registered commands, ${leaves.length} leaves, ${TEAM_ONLY_LEAVES.length} team-only actions and ${TEAM_ONLY_COMMANDS.length} team tools kept out of slash)`);
})().catch((error) => { console.error(error); process.exit(1); });

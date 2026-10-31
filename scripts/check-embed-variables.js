const assert = require('node:assert/strict');
// Fails when the variable list shown to people and the engine that resolves variables disagree.
const fs = require('node:fs');
const path = require('node:path');
const { VARIABLE_GROUPS } = require('../src/utils/embedVariableRegistry');

const engineSource = fs.readFileSync(path.join(__dirname, '../src/utils/embedVariables.js'), 'utf8');
const flagSource = fs.readFileSync(path.join(__dirname, '../src/utils/messageFlags.js'), 'utf8');
const imgCardSource = fs.readFileSync(path.join(__dirname, '../src/utils/imgCardTokens.js'), 'utf8');
const bumpSource = fs.readFileSync(path.join(__dirname, '../src/utils/bumpHandler.js'), 'utf8');

const engineTokens = new Set([...engineSource.matchAll(/^\s*'(\{[^']+\})':/gm)].map((match) => match[1]));
// The extra quest variables are added to the engine's map from a list, so they are read from that list.
if (engineSource.includes('QUEST_EXTRA_KEYS')) for (const key of require('../src/utils/questTime').QUEST_EXTRA_KEYS) engineTokens.add(`{quest.${key}}`);
const listed = VARIABLE_GROUPS.flatMap((group) => group.vars);
const listedTokens = new Set(listed.map((variable) => variable.tok));

const problems = [];

for (const token of engineTokens) {
  if (!listedTokens.has(token)) problems.push(`${token} is resolved by the engine but missing from the registry`);
}

// Dynamic variables are matched by patterns, so each one is checked against the pattern's own name.
const dynamicChecks = [
  [/^\{choose/, /choose\\d\*:/, engineSource],
  [/^\{range:/, /range:/, engineSource],
  [/^\{timestamp:/, /timestamp:/, engineSource],
  [/^\{arg\d+\}$/, /\{arg\(\\d\{1,2\}\)\\\}/, engineSource],
  [/^\{args_from:/, /args_from:/, engineSource],
  [/^\{reactreply/, /reactreply/, flagSource],
  [/^\{imgcard:/, /imgcard:/, imgCardSource],
  [/^\{nextBump\}$/, /nextBump/, bumpSource],
];

for (const variable of listed) {
  if (engineTokens.has(variable.tok)) continue;
  const check = dynamicChecks.find(([shape]) => shape.test(variable.tok));
  if (!check) {
    problems.push(`${variable.tok} is in the registry but the engine has no key or pattern for it`);
  } else if (!variable.dynamic) {
    problems.push(`${variable.tok} is handled by a pattern, mark it dynamic in the registry`);
  } else if (!check[1].test(check[2])) {
    problems.push(`${variable.tok} is marked dynamic but its pattern was not found in the engine`);
  }
}

// A variable may appear in more than one group when it means something in each context, but not twice in one.
for (const group of VARIABLE_GROUPS) {
  const seen = new Set();
  for (const variable of group.vars) {
    if (seen.has(variable.tok)) problems.push(`${variable.tok} is listed more than once in ${group.label}`);
    seen.add(variable.tok);
  }
}

if (problems.length) {
  console.error('Embed variable registry is out of sync:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

// A variable is found whatever its case, with spaces inside the braces, and by the names other bots use for it.
(async () => {
  const { resolve } = require('../src/utils/embedVariables');
  const user = { id: '42', username: 'liam', displayAvatarURL: () => 'avatar' };
  const ctx = { user, levelData: { level: 5, xp: 1200, progress: 40, rank: 3, total: 20 }, levelReward: { id: '7', name: 'Gold' } };
  assert.equal(await resolve('{user.mention}|{ User.Mention }|{USER_MENTION}|{mention}', ctx), '<@42>|<@42>|<@42>|<@42>');
  assert.equal(await resolve('{level.rank}/{level.total} {level.role_name} {level_role}', ctx), '3/20 Gold <@&7>');
  assert.equal(await resolve('{not.a.variable} stays', ctx), '{not.a.variable} stays', 'an unknown variable is left as it was');
  // The words Petto itself puts in a variable follow the server language; the list for the dashboard keeps its tokens in every language.
  const bot = { ...user, bot: true };
  assert.equal(await resolve('{user.bot}', { user: bot }), 'Yes');
  assert.equal(await resolve('{user.bot}', { user: bot, lang: 'es' }), 'Sí');
  assert.equal(await resolve('{user.bot} {inviter}', { user: bot, lang: 'pt-BR' }), 'Sim Desconhecido');
  // The names other bots use for boosts and levels work too.
  const levelled = { guild: { premiumSubscriptionCount: 7, premiumTier: 1, members: { cache: new Map() }, iconURL: () => null, bannerURL: () => null, emojis: { cache: new Map() }, roles: { cache: new Map() }, channels: { cache: new Map() } }, levelData: { level: 5, xp: 1234 } };
  assert.equal(await resolve('{boost.count} {Level.New_Rank} {level.user_xp}', levelled), '7 5 1,234');
  const { listVariables } = require('../src/utils/embedVariableRegistry');
  const spanish = listVariables('es');
  assert.deepEqual(spanish.map((group) => group.vars.map((variable) => variable.tok)), VARIABLE_GROUPS.map((group) => group.vars.map((variable) => variable.tok)), 'the tokens never change');
  assert.equal(spanish.find((group) => group.id === 'user').vars[0].desc, 'Menciona al usuario');
  assert.ok(spanish.flatMap((group) => group.vars).every((variable) => variable.desc && !variable.desc.startsWith('embeds.')), 'every variable has a description');
  assert.deepEqual(listVariables(), VARIABLE_GROUPS, 'outside of a command the list is the English one');
  console.log(`Checked ${listed.length} embed variables against the engine.`);
})();

// Close spellings and the account and member age (checked after the list above, with the same engine).
(async () => {
  const { resolve } = require('../src/utils/embedVariables');
  const { Collection } = require('discord.js');
  const day = 86_400_000;
  const user = { id: '1', username: 'ana', createdTimestamp: Date.now() - 800 * day, displayAvatarURL: () => '' };
  const member = { user, displayName: 'Ana B', joinedTimestamp: Date.now() - 3 * day, displayAvatarURL: () => '', roles: { cache: new Collection(), highest: { name: 'x' } } };
  const guild = { id: '9', name: 'Petto', memberCount: 1204, premiumTier: 0, premiumSubscriptionCount: 0, iconURL: () => null, bannerURL: () => null, members: { cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() } };
  const out = (text, lang) => resolve(text, { member, user, guild, lang });
  assert.equal(await out('{user.account_age_days}'), '800');
  assert.equal(await out('{user.account_age}'), '2 years');
  assert.match(await out('{user.joined_age}'), /3 days/);
  assert.match(await out('{user.account_age}', 'es'), /2 años/, 'the age is written in the language of the server');
  assert.equal(await resolve('{user.account_age}|{user.joined_age}|{user.account_age_days}', {}), '||', 'without a member the age is empty, never undefined');
  assert.equal(await out('{user.displayname}'), 'Ana B', 'a close spelling works');
  assert.equal(await out('{User.Display_Name}'), 'Ana B');
  assert.equal(await out('{server_member_count}'), '1204');
  assert.equal(await out('{servermembercount}'), '1204');
  assert.equal(await out('{nothing.here}'), '{nothing.here}', 'an unknown variable stays as written');
  console.log('Checked close spellings and ages.');
})().catch((error) => { console.error(error); process.exit(1); });

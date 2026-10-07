// Fails when the variable list shown to people and the engine that resolves variables disagree.
const fs = require('node:fs');
const path = require('node:path');
const { VARIABLE_GROUPS } = require('../src/utils/embedVariableRegistry');

const engineSource = fs.readFileSync(path.join(__dirname, '../src/utils/embedVariables.js'), 'utf8');
const flagSource = fs.readFileSync(path.join(__dirname, '../src/utils/messageFlags.js'), 'utf8');
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

console.log(`Checked ${listed.length} embed variables against the engine.`);

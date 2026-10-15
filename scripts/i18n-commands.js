// The descriptions of the commands in the catalogs. They are written in English in each command's builder; this keeps
// `src/i18n/locales/en/cmd.<category>.js` equal to the builders, and tells which Spanish and Portuguese ones are missing.
//   node scripts/i18n-commands.js moderation tickets   writes the English catalogs of those categories
//   node scripts/i18n-commands.js --all               writes every category
//   node scripts/i18n-commands.js --status            lists what is missing, writes nothing
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales');

/** Every description of every command, as { category: [[key, english], ...] } in the order of the builders. */
function commandEntries() {
  const resolvedDb = require.resolve('../src/db/database');
  if (!require.cache[resolvedDb]) require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: () => ({}) } };
  const { findCommandFiles, COMMANDS_DIR } = require('../src/handlers/commandHandler');
  const { commandDescriptionKey } = require('../src/i18n');
  const byCategory = {};
  const seenNames = new Set();
  for (const file of findCommandFiles(COMMANDS_DIR)) {
    const command = require(file);
    if (!command?.data?.toJSON) continue;
    const json = command.data.toJSON();
    if ((json.type ?? 1) !== 1 || seenNames.has(json.name)) continue; // menus have no description; a duplicate is not loaded
    seenNames.add(json.name);
    const category = path.relative(COMMANDS_DIR, file).split(path.sep).length > 1 ? path.relative(COMMANDS_DIR, file).split(path.sep)[0] : 'other';
    const entries = (byCategory[category] ??= []);
    const walk = (node, parts, option) => {
      if (node.description) entries.push([commandDescriptionKey(category, json.name, parts, option), node.description]);
      for (const child of node.options ?? []) {
        if (child.type === 1 || child.type === 2) walk(child, [...parts, child.name], null);
        else walk(child, parts, child.name);
      }
    };
    walk(json, [], null);
  }
  return byCategory;
}

/** Every text the builders hold that people never read in the prefix commands (choice names): not reported as hard-coded text. */
function builderTexts() {
  const texts = new Set();
  const { findCommandFiles, COMMANDS_DIR } = require('../src/handlers/commandHandler');
  for (const file of findCommandFiles(COMMANDS_DIR)) {
    const command = require(file);
    if (!command?.data?.toJSON) continue;
    const walk = (node) => {
      if (node.description) texts.add(node.description);
      for (const choice of node.choices ?? []) texts.add(choice.name);
      for (const child of node.options ?? []) walk(child);
    };
    walk(command.data.toJSON());
  }
  return texts;
}

const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

function writeEnglish(category, entries) {
  const file = path.join(LOCALES_DIR, 'en', `cmd.${category}.js`);
  const seen = new Set();
  const lines = entries.filter(([key]) => !seen.has(key) && seen.add(key)).map(([key, text]) => `  ${quote(key)}: ${quote(text)},`);
  fs.writeFileSync(file, `// Descriptions of the ${category} commands, written by scripts/i18n-commands.js from the builders: change the builder, then run it.\nmodule.exports = {\n${lines.join('\n')}\n};\n`);
  return file;
}

module.exports = { commandEntries, builderTexts };

if (require.main === module) {
  const args = process.argv.slice(2);
  const all = commandEntries();
  const categories = args.includes('--all') ? Object.keys(all) : args.filter((arg) => !arg.startsWith('--'));
  for (const category of categories) {
    if (!all[category]) { console.error(`No commands in category "${category}". Known: ${Object.keys(all).join(', ')}`); process.exit(2); }
    console.log(`Wrote ${path.relative(ROOT, writeEnglish(category, all[category]))} (${all[category].length} descriptions).`);
  }
  if (args.includes('--status') || !categories.length) {
    for (const [category, entries] of Object.entries(all)) {
      const missing = {};
      for (const lang of ['es', 'pt-BR']) {
        const file = path.join(LOCALES_DIR, lang, `cmd.${category}.js`);
        const catalog = fs.existsSync(file) ? require(file) : {};
        missing[lang] = entries.filter(([key]) => !Object.hasOwn(catalog, key)).length;
      }
      const english = fs.existsSync(path.join(LOCALES_DIR, 'en', `cmd.${category}.js`));
      console.log(`${category}: ${entries.length} descriptions, English catalog ${english ? 'written' : 'not written'}, missing es ${missing.es}, pt-BR ${missing['pt-BR']}`);
    }
  }
}

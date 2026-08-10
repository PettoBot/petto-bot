const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['index.js', 'deploy-commands.js', 'src'];
const ignored = new Set(['node_modules', '.git']);

function collect(entry) {
  const absolute = path.resolve(entry);
  if (!fs.existsSync(absolute)) return [];
  const info = fs.statSync(absolute);
  if (info.isFile()) return path.extname(absolute) === '.js' ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((child) => {
    if (child.isDirectory() && ignored.has(child.name)) return [];
    return collect(path.join(absolute, child.name));
  });
}

const files = [...new Set(roots.flatMap(collect))].sort();
const failed = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed.push(path.relative(process.cwd(), file));
}

if (failed.length) {
  console.error(`Syntax errors found in ${failed.length} file(s):`);
  for (const file of failed) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Checked ${files.length} JavaScript files.`);

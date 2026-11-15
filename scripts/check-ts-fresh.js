// The TypeScript files of src/ are compiled over their .js (`npm run build:ts`), and the .js is what the bot loads. GitHub builds them again and
// refuses the change when a .js is not what the .ts gives (`git diff --exit-code -- src`). This does the same here, so a changed .ts whose .js was not
// built is found before it is pushed: it compiles to a temporary folder and compares each file with the one of src/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'petto-ts-fresh-'));
try {
  const tsc = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');
  const result = spawnSync(process.execPath, [tsc, '--project', path.join(root, 'tsconfig.json'), '--outDir', out], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `tsc failed:\n${result.stdout}${result.stderr}`);
  const stale = [];
  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.name.endsWith('.js')) continue;
      count += 1;
      const committed = path.join(root, 'src', path.relative(out, file));
      if (!fs.existsSync(committed) || fs.readFileSync(committed, 'utf8') !== fs.readFileSync(file, 'utf8')) stale.push(path.relative(root, committed));
    }
  };
  walk(out);
  assert.ok(count > 0, 'no TypeScript file was compiled');
  assert.deepEqual(stale, [], `These .js are not what their .ts gives, run npm run build:ts:\n${stale.join('\n')}`);
  console.log(`Checked that the ${count} compiled files are what their TypeScript gives.`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

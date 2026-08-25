const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const tempOutput = path.join(root, '.ts-build');
const configPath = path.join(root, 'tsconfig.json');
const tscPath = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');

fs.rmSync(tempOutput, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscPath, '--project', configPath], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  fs.rmSync(tempOutput, { recursive: true, force: true });
  process.exit(1);
}

if (result.status !== 0) {
  fs.rmSync(tempOutput, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

function copyGeneratedJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      copyGeneratedJavaScript(source);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    const relative = path.relative(tempOutput, source);
    const destination = path.join(sourceRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

copyGeneratedJavaScript(tempOutput);
fs.rmSync(tempOutput, { recursive: true, force: true });

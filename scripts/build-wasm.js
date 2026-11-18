// Builds the Rust word finder (native/wordmatch) to WebAssembly and puts it in src/native/wordmatch.wasm, which is what the bot loads. The .wasm is committed, so
// the bot does not need Rust to run (and falls back to JavaScript if the file is missing). Needs Rust with the target wasm32-unknown-unknown:
//   rustup target add wasm32-unknown-unknown && npm run build:wasm
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const crate = path.join(root, 'native', 'wordmatch');
const result = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crate, stdio: 'inherit' });
if (result.status !== 0) { console.error('cargo build failed (is Rust installed, with the target wasm32-unknown-unknown?)'); process.exit(result.status ?? 1); }
const built = path.join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'wordmatch.wasm');
fs.mkdirSync(path.join(root, 'src', 'native'), { recursive: true });
fs.copyFileSync(built, path.join(root, 'src', 'native', 'wordmatch.wasm'));
console.log(`src/native/wordmatch.wasm: ${fs.statSync(path.join(root, 'src', 'native', 'wordmatch.wasm')).size} bytes`);

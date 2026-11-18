// Checks the Rust word finder (native/wordmatch, built to src/native/wordmatch.wasm): that it loads, that it finds the same as the JavaScript way on thousands of random texts and
// words (as parts of a text and as whole words), that it is faster with a big list, and (when Rust is installed) that the committed .wasm is what the source builds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const m = require('../src/utils/modRules');
const wasm = require('../src/utils/wordMatchWasm');

assert.equal(wasm.wasmAvailable(), true, 'src/native/wordmatch.wasm loads (npm run build:wasm makes it)');

// A small deterministic random generator, so a failure can be repeated.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const alphabet = 'abcdefghij kl-ñéüß0123 ,.!?'.split('');
const word = (min, max) => Array.from({ length: min + Math.floor(rnd() * (max - min + 1)) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('').trim() || 'a';

for (const how of ['contains', 'word']) {
  const words = Array.from({ length: 1500 }, () => word(2, 7));
  const fast = m.wordMatcher(words, how);
  const slow = m.wordMatcher(words, how, { useWasm: false });
  let disagreements = 0;
  for (let i = 0; i < 4000; i += 1) {
    const text = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => word(1, 9)).join(rnd() < 0.5 ? ' ' : '');
    const a = fast(text);
    const b = slow(text);
    if ((a === null) !== (b === null)) { disagreements += 1; if (disagreements < 4) console.log(`${how}: "${text}" -> wasm ${a}, js ${b}`); }
    if (a !== null) assert.ok(words.map((w) => m.normalizeText(w).trim()).includes(a), `${how}: what it found is one of the words`);
  }
  assert.equal(disagreements, 0, `${how}: the Rust finder and the JavaScript one agree`);
}

// Unicode texts and words.
const uni = m.wordMatcher(Array.from({ length: 400 }, (_x, i) => `palabra${i}`).concat(['niño', '日本語', 'ЗАПРЕТ']), 'word');
assert.equal(uni('un NIÑO aquí'), 'nino', 'accents are taken out of both');
assert.equal(uni('日本語です'), null, 'a whole word is not part of a longer word of letters');
assert.equal(uni('это ЗАПРЕТ.'), 'запрет');

// A big list is faster in Rust (it is only said, never failed on: a slow machine is not a bug).
const big = Array.from({ length: 20000 }, (_x, i) => `w${i.toString(36)}q${(i * 7919).toString(36)}`);
const text = 'this message has no bad word at all but it is long enough to be a fair test of the speed '.repeat(8);
const timeOf = (matcher) => { const start = process.hrtime.bigint(); for (let i = 0; i < 300; i += 1) matcher(text); return Number(process.hrtime.bigint() - start) / 1e6; };
const rustMs = timeOf(m.wordMatcher(big, 'contains'));
const jsMs = timeOf(m.wordMatcher(big, 'contains', { useWasm: false }));
console.log(`20000 words, 300 messages: Rust ${rustMs.toFixed(0)} ms, JavaScript ${jsMs.toFixed(0)} ms`);

// The committed .wasm is what the source builds (only when Rust is here).
const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
const target = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
if (cargo.status === 0 && /wasm32-unknown-unknown/.test(target.stdout || '')) {
  const crate = path.join(__dirname, '..', 'native', 'wordmatch');
  const build = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crate, encoding: 'utf8' });
  assert.equal(build.status, 0, `cargo build failed:\n${build.stderr}`);
  const built = fs.readFileSync(path.join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'wordmatch.wasm'));
  assert.ok(built.equals(fs.readFileSync(path.join(__dirname, '..', 'src', 'native', 'wordmatch.wasm'))), 'src/native/wordmatch.wasm is not what native/wordmatch builds: run npm run build:wasm');
} else {
  console.log('Rust with the target wasm32-unknown-unknown is not here: the committed .wasm was not compared with its source.');
}
console.log('check-wordmatch: ok');

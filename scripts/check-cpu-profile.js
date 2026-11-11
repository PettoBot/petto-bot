// Checks the CPU profile of `!perf cpu`: how a profile is added up (with one made by hand, so the numbers are exact), the text of the file names,
// the seconds a person can ask for, and a real capture in which a function that burns processor on purpose must come out first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cpuProfile = require('../src/utils/cpuProfile');

(async () => {
  // ---- file names
  assert.equal(cpuProfile.shortUrl('file:///app/src/utils/roleQuotas.js'), 'src/utils/roleQuotas.js');
  assert.equal(cpuProfile.shortUrl('file:///app/node_modules/discord.js/src/x.js'), 'discord.js/src/x.js', 'what is in node_modules is named from the package');
  assert.equal(cpuProfile.shortUrl('node:internal/timers'), 'node:internal/timers');
  assert.equal(cpuProfile.shortUrl(''), '(native)');
  assert.equal(cpuProfile.shortUrl('/opt/app/lib/z.js'), 'lib/z.js', 'the last two parts when nothing else is known');

  // ---- seconds
  assert.equal(cpuProfile.parseSeconds(''), 10);
  assert.equal(cpuProfile.parseSeconds(undefined), 10);
  assert.equal(cpuProfile.parseSeconds('abc'), 10);
  assert.equal(cpuProfile.parseSeconds('1'), 3, 'at least 3');
  assert.equal(cpuProfile.parseSeconds('999'), 30, 'at most 30');
  assert.equal(cpuProfile.parseSeconds('15'), 15);
  assert.equal(cpuProfile.parseSeconds('7.6'), 8);

  // ---- adding up a profile made by hand: each sample covers the gap to the next one (the last one reuses the one before it)
  const frame = (functionName, url, lineNumber = 0) => ({ functionName, url, lineNumber });
  const profile = {
    nodes: [
      { id: 1, callFrame: frame('(root)', '') },
      { id: 2, callFrame: frame('(idle)', '') },
      { id: 3, callFrame: frame('heavy', 'file:///app/src/utils/a.js', 9) },
      { id: 4, callFrame: frame('light', 'file:///app/node_modules/pkg/b.js', 0) },
      { id: 5, callFrame: frame('(garbage collector)', '') },
      { id: 6, callFrame: frame('', 'file:///app/src/utils/a.js', 29) },
    ],
    samples: [2, 3, 3, 4, 5, 6, 2],
    timeDeltas: [0, 4000, 1000, 1000, 1000, 1000, 2000],
  };
  const sum = cpuProfile.summarize(profile);
  // Sample covers: idle 4000, heavy 1000, heavy 1000, light 1000, gc 1000, anonymous 2000 (next gap is 2000), idle 2000 (the last reuses it).
  assert.equal(sum.idleMs, 6, 'idle: 4 ms + 2 ms');
  assert.equal(sum.busyMs, 6, 'busy: heavy 2 + light 1 + gc 1 + anonymous 2');
  assert.equal(sum.gcMs, 1);
  assert.equal(sum.totalMs, 12);
  assert.deepEqual(sum.functions.map((row) => [row.name, row.file, row.line, row.ms, row.percent]), [
    ['heavy', 'src/utils/a.js', 10, 2, 33.3],
    ['(anonymous)', 'src/utils/a.js', 30, 2, 33.3],
    ['light', 'pkg/b.js', 1, 1, 16.7],
  ], 'the most expensive first; line numbers start at 1; a function with no name is anonymous');
  assert.deepEqual(sum.files.map((row) => [row.file, row.ms]), [['src/utils/a.js', 4], ['pkg/b.js', 1]], 'by file');
  assert.deepEqual(cpuProfile.summarize({}).functions, [], 'an empty profile does not break');
  assert.deepEqual(cpuProfile.summarize(null).files, []);
  assert.equal(cpuProfile.summarize(profile, { top: 1 }).functions.length, 1, 'the number of rows can be limited');

  // ---- the text
  const text = cpuProfile.describe(sum, 10);
  assert.ok(text.includes('busy 50%') && text.includes('heavy · src/utils/a.js:10') && text.includes('**By file**'), 'the card says how busy it was, the functions and the files');
  assert.ok(cpuProfile.describe(cpuProfile.summarize({}), 5).includes('nothing ran'));

  // ---- a real capture: a function that burns processor on purpose has to come out first
  function burnProcessorForTheCheck() {
    let x = 0;
    const until = Date.now() + 400;
    while (Date.now() < until) x += Math.sqrt(x + 1);
    return x;
  }
  const waiting = [];
  const result = await cpuProfile.capture(1, { wait: async () => { burnProcessorForTheCheck(); } });
  assert.equal(result.functions[0].name, 'burnProcessorForTheCheck', 'the function that burned the processor is the first');
  assert.ok(result.functions[0].ms >= 250, `it used about 400 ms, saw ${result.functions[0].ms}`);
  assert.ok(result.functions[0].file.endsWith('check-cpu-profile.js'));
  assert.equal(cpuProfile.isRunning(), false, 'a capture that ends leaves nothing running');

  // Only one at a time, and a failure leaves the way free again.
  const first = cpuProfile.capture(1, { wait: () => new Promise((resolve) => setTimeout(resolve, 50)) });
  await assert.rejects(() => cpuProfile.capture(1), /busy/, 'a second profile at the same time is refused');
  await first;
  await assert.rejects(() => cpuProfile.capture(1, { wait: async () => { throw new Error('stopped'); } }), /stopped/);
  assert.equal(cpuProfile.isRunning(), false, 'after a failure a new one can run');
  void waiting;

  // ---- the command knows it, and the team documentation says it
  const command = fs.readFileSync(path.join(__dirname, '..', 'src/commands/utility/perf.js'), 'utf8');
  assert.ok(/section === 'cpu'/.test(command) && /loadGuard\.level\(\) === 'critical'/.test(command), 'the command has the cpu section and refuses at the critical level');
  assert.ok(/'!perf cpu \[seconds\]'/.test(command), 'the usage says it');
  console.log('CPU profile checks passed (file names, seconds, adding up, the text, a real capture, one at a time).');
})().catch((err) => { console.error(err); process.exit(1); });

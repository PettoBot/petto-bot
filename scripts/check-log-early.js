// What the log of Discord says about the time before it was connected: the Cloudflare tunnel and every warning and error, and nothing else.
const assert = require('node:assert/strict');
const path = require('node:path');

const quiet = () => {};
const realLog = console.log; const realWarn = console.warn; const realError = console.error;
console.log = quiet; console.warn = quiet; console.error = quiet;
delete require.cache[path.resolve(__dirname, '../src/utils/logger.js')];
const logger = require('../src/utils/logger');

logger.info('Running migrations...');
logger.info('[cloudflared] Registered tunnel connection connIndex=0');
logger.info('Cloudflare Tunnel started.');
logger.warn('The commands could not be registered');
logger.error('Something failed', new Error('boom'));
logger.info('Loaded 300 commands');

// A sink of errors attached at the very start (like the real ones) must not use up the lines.
const errorSink = [];
logger.addDiscordSink((level, args) => errorSink.push(level));
logger.warn('a warning after the first sink');
const said = [];
logger.addDiscordSink((level, args) => said.push(`${level}:${args.map(String).join(' ')}`), { replayEarly: true });
console.log = realLog; console.warn = realWarn; console.error = realError;

assert.equal(said.length, 5, 'the tunnel lines and the warnings are told when the general log connects, and the ordinary ones are not');
assert.ok(said[0].includes('cloudflared'), 'in the order they happened');
assert.ok(said.some((line) => line.startsWith('warn:')) && said.some((line) => line.startsWith('error:')));
assert.ok(!said.some((line) => line.includes('migrations') || line.includes('Loaded 300')), 'a normal start adds no noise');

console.log = quiet;
logger.info('[cloudflared] after');
console.log = realLog;
assert.equal(said.length, 6, 'after that every line goes straight to the log');
let second = 0;
logger.addDiscordSink(() => { second += 1; }, { replayEarly: true });
assert.equal(second, 0, 'a second log does not get the old lines again');
console.log('Checked what the log of Discord says about the time before it was connected.');

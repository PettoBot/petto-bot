// Checks that the tunnel's output never puts its token in the logs.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
{ const resolved = require.resolve('cloudflared'); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { install: async () => {} } }; }
const { tunnelEnv, cleanTunnelLine } = require('../src/web/cloudflareTunnel');

const token = 'eyJhIjoiMjZmNzE0NTJhNzQ3YjI5ZWNkYTBkODc2MjM0YTZmNDYiLCJ0IjoiNmE0ZDM2ZDEifQ';
assert.equal(cleanTunnelLine(`2026-10-03T00:20:15Z INF Environmental variables map[CLOUDFLARE_TUNNEL_TOKEN:${token}]`, token), null, 'the line that lists the environment is dropped');
assert.equal(cleanTunnelLine(`connecting with ${token} now`, token), 'connecting with [hidden] now', 'the token is hidden wherever it appears');
assert.equal(cleanTunnelLine('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef', 'other'), 'token [hidden]', 'anything shaped like a token is hidden');
assert.equal(cleanTunnelLine('Registered tunnel connection connIndex=0', token), 'Registered tunnel connection connIndex=0', 'normal lines are kept');
assert.equal(cleanTunnelLine('Settings: map[token:*****]', token), 'Settings: map[token:*****]');

const env = tunnelEnv({ PATH: '/bin', CLOUDFLARE_TUNNEL_TOKEN: token, TUNNEL_TOKEN: token, DISCORD_TOKEN: 'x' });
assert.deepEqual(Object.keys(env).sort(), ['DISCORD_TOKEN', 'PATH'], 'the tunnel does not get the token variables');

console.log('Checked the Cloudflare tunnel logs: the token is never printed.');

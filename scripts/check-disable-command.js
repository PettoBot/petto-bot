// Checks !disablecommand: several commands at once, the ones that cannot be disabled, unknown names, "all", and the list.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const rules = [];
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/disabledCommands.js', {
  find: async (g, command, channel) => rules.find((r) => r.command === command && (r.channel_id ?? null) === (channel ?? null)) ?? null,
  disable: async (g, command, channel) => { rules.push({ guild_id: g, command, channel_id: channel ?? null }); },
  enable: async (g, command, channel) => { const i = rules.findIndex((r) => r.command === command && (r.channel_id ?? null) === (channel ?? null)); if (i < 0) return false; rules.splice(i, 1); return true; },
  clear: async () => { const n = rules.length; rules.length = 0; return n; },
  listForGuild: async () => rules.slice(),
});
const disablecommand = require('../src/commands/automation/disablecommand');

const known = new Set(['roles', 'emojis', 'help', 'disablecommand']);
const client = { commands: { has: (name) => known.has(name) }, commandAliases: new Map([['rl', 'roles']]), commandRoutes: new Map() };
const text = (payload) => JSON.stringify(payload.components.map((c) => c.toJSON()));
function run(sub, command, channel = null) {
  const sent = [];
  const interaction = {
    client, guild: { id: '1', name: 'Test', iconURL: () => null }, user: { id: '9' },
    options: { getSubcommand: () => sub, getString: () => command, getChannel: () => channel },
    deferReply: async () => {}, editReply: async (p) => sent.push(p), reply: async (p) => sent.push(p),
  };
  return disablecommand.execute(interaction).then(() => sent[0]);
}

(async () => {
  let out = text(await run('disable', 'roles, emojis rl help disablecommand nothing'));
  assert.match(out, /Disabled `roles`, `emojis`/);
  assert.ok(!/Already disabled/.test(out), 'an alias counts as the command it points to, so it is not listed twice');
  assert.match(out, /cannot be disabled.*`help`, `disablecommand`/);
  assert.match(out, /don't know.*`nothing`/);
  assert.deepEqual(rules.map((r) => r.command), ['roles', 'emojis']);

  out = text(await run('disable', 'roles', { id: '77', toString: () => '<#77>' }));
  assert.match(out, /Disabled `roles` in <#77>/);
  assert.equal(rules.length, 3, 'a channel rule is separate from the server rule');

  out = text(await run('enable', 'roles'));
  assert.match(out, /Enabled `roles` server-wide/);
  out = text(await run('enable', 'roles'));
  assert.match(out, /There is no rule for the whole server on: `roles`/);

  out = text(await run('list', ''));
  assert.match(out, /Disabled commands \(2\)/); assert.match(out, /`emojis` — the whole server/); assert.match(out, /`roles` — <#77>/);

  out = text(await run('enable', 'all'));
  assert.match(out, /2 commands are enabled again/);
  assert.match(text(await run('enable', 'all')), /No commands are disabled/);
  assert.match(text(await run('list', '')), /No commands are disabled/);
  assert.match(text(await run('disable', ' , ')), /at least one command/);
  assert.match(text(await run('disable', Array.from({ length: 30 }, (_, n) => `c${n}`).join(' '))), /up to 25/);

  console.log('disablecommand ok');
})().catch((error) => { console.error(error); process.exit(1); });

// The GENERAL channel of errors (the priority one is checked in check-error-triage.js): routine rate limit notes are left out, the same problem is sent once with a count, and a burst goes out slowly.
const assert = require('node:assert/strict');
const { createDiscordErrorLogSink, isRoutineNoise, duplicateKey } = require('../src/utils/discordErrorLog');

assert.equal(isRoutineNoise('warn', ['[Discord REST] user rate limit on GET /channels/:id/messages/:id; retry after 4.2s; bucket limit 5.']), true);
assert.equal(isRoutineNoise('warn', ['[Discord REST] global rate limit on POST /channels/:id/messages; retry after 1s']), true);
assert.equal(isRoutineNoise('error', ['[Discord REST] rate limit on POST x']), false, 'an error is always sent');
assert.equal(isRoutineNoise('warn', ['Something else failed']), false);
assert.equal(duplicateKey('warn', ['retry after 4.2s on 1234']), duplicateKey('warn', ['retry after 0.6s on 99']), 'numbers are ignored when comparing');
assert.notEqual(duplicateKey('warn', ['a']), duplicateKey('error', ['a']));

(async () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (payload) => { sent.push(payload); } };
  const client = { channels: { cache: new Map([['c', channel]]), fetch: async () => channel } };
  let clock = 1_000_000;
  const sink = createDiscordErrorLogSink(client, 'c', { gapMs: 5, now: () => clock });

  await sink('warn', ['[Discord REST] user rate limit on GET /x; retry after 1s'], new Date().toISOString());
  await sink('info', ['hello']);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 0, 'rate limit notes and info are not sent');

  for (let i = 0; i < 5; i += 1) await sink('warn', [`[Activity detail] increment failed: connection ${i}`], new Date().toISOString());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 1, 'the same warning five times is one message');

  clock += 61_000;
  await sink('warn', ['[Activity detail] increment failed: connection 9'], new Date().toISOString());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 2, 'after a minute it is sent again');
  assert.match(JSON.stringify(sent[1].embeds[0].toJSON().footer), /4 similar/, 'with how many were not repeated');

  for (let i = 0; i < 60; i += 1) await sink('warn', [`distinct problem ${'x'.repeat(i + 1)}`], new Date().toISOString());
  await sink('error', ['a real error'], new Date().toISOString());
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(sent.length <= 2 + 21, 'a long burst is cut');
  assert.ok(sent.some((payload) => JSON.stringify(payload.embeds[0].toJSON()).includes('a real error')), 'the error is still sent');
  // An error that the triage turned into a warning is always told (even "Missing Permissions"), with what it means; secrets never reach the card.
  const before = sent.length;
  await sink('warn', ['Missing Permissions while setting up postgres://user:pw@host/db'], new Date().toISOString(), { triaged: true, explanation: 'The server did not give Petto a permission.' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, before + 1, 'a triaged error is not routine noise');
  const triaged = JSON.stringify(sent.at(-1).embeds[0].toJSON());
  assert.ok(triaged.includes('What it means') && !triaged.includes('user:pw'), 'it says what it means and the password of an address is removed');
  assert.deepEqual(sent.at(-1).allowedMentions, { parse: [] }, 'the general log never pings');
  // The channels of the team are in the support server, which only one instance holds: a worker asks for them with `allowUnknownGuild`, or discord.js answers nothing for them.
  const reached = [];
  const workerChannel = { isTextBased: () => true, send: async (payload) => { reached.push(payload); return { edit: async () => {} }; } };
  const worker = { channels: { cache: new Map(), fetch: async (id, options) => (options?.allowUnknownGuild ? workerChannel : undefined) } };
  const workerSink = createDiscordErrorLogSink(worker, 'c', { gapMs: 5, now: () => 9_000_000 });
  await workerSink('error', ['[Worker] something failed on a server this process holds'], new Date().toISOString());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(reached.length >= 1, 'an error seen by a worker reaches the log channel of the support server');
  console.log('Checked the error channel: no rate limit notes, no repeats and a slow burst.');
})();

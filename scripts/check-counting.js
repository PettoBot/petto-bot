// The counting game: reading numbers and sums, the rules of a right and a wrong number, and a channel from start to end.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const { readNumber, judge, afterCorrect, afterWrong } = require('../src/utils/counting');

(async () => {
  // Reading: a number, or a sum when the server allows it. Chat and results that are not whole numbers are nothing.
  assert.equal(readNumber('12'), 12);
  assert.equal(readNumber(' 1,000 '), 1000);
  assert.equal(readNumber('2*3+1'), 7);
  assert.equal(readNumber('(4+4)/2'), 4);
  assert.equal(readNumber('2^3'), 8);
  assert.equal(readNumber('2x3'), 6);
  assert.equal(readNumber('7/2'), null);
  assert.equal(readNumber('hello'), null);
  assert.equal(readNumber('5 nice'), null);
  assert.equal(readNumber('2+2', { math: false }), null);
  assert.equal(readNumber('process.exit()'), null, 'nothing is run as code');
  assert.equal(readNumber('9'.repeat(30)), null);

  const base = { current_number: 4, last_user_id: 'u1', allow_double: false, math: true, high_score: 10, total_correct: 4, total_wrong: 0, saves: 0, saves_max: 0, save_every: 100, milestone_every: 100, reset_on_wrong: true, start_number: 0 };
  assert.deepEqual(judge({ text: 'lol', authorId: 'u2', config: base }), { kind: 'ignore' });
  assert.equal(judge({ text: '5', authorId: 'u2', config: base }).kind, 'ok');
  assert.equal(judge({ text: '2+3', authorId: 'u2', config: base }).kind, 'ok', 'a sum counts');
  assert.equal(judge({ text: '5', authorId: 'u1', config: base }).kind, 'double');
  assert.equal(judge({ text: '5', authorId: 'u1', config: { ...base, allow_double: true } }).kind, 'ok');
  const wrong = judge({ text: '9', authorId: 'u2', config: base });
  assert.deepEqual([wrong.kind, wrong.expected], ['wrong', 5]);

  // What the game keeps: the number, the record, a save every so many, a message at the milestones.
  let step = afterCorrect({ ...base, current_number: 99, saves_max: 2, saves: 1 }, 100);
  assert.equal(step.patch.current_number, 100);
  assert.equal(step.patch.high_score, 100);
  assert.equal(step.record, true);
  assert.equal(step.patch.saves, 2, 'a save is earned at 100');
  assert.equal(step.milestone, true);
  step = afterCorrect({ ...base, current_number: 4 }, 5);
  assert.equal(step.record, false);
  assert.equal(step.milestone, false);

  // A mistake: a save is used if there is one, otherwise the count goes back.
  assert.deepEqual(afterWrong({ ...base, saves: 1 }), { patch: { saves: 0, total_wrong: 1 }, saved: true, reset: false });
  const lost = afterWrong(base);
  assert.deepEqual([lost.saved, lost.reset, lost.patch.current_number, lost.patch.last_user_id], [false, true, 0, null]);
  assert.equal(afterWrong({ ...base, reset_on_wrong: false }).patch.current_number, undefined, 'with no reset the number stays');

  // A channel from start to end, with the storage and Discord replaced.
  let config = { ...base, guild_id: 'g1', enabled: true, channel_id: 'c1', current_number: 0, last_user_id: null, last_message_id: null, high_score: 0, total_correct: 0, delete_wrong: false, react_ok: '✅', react_bad: '❌', react_record: '🏆' };
  const users = new Map();
  const kept = new Map();
  stub('src/db/counting.js', {
    getConfig: async () => config,
    updateConfig: async (_g, patch) => { config = { ...config, ...patch }; return config; },
    bumpUser: async (_g, id, delta) => { const row = users.get(id) ?? { correct: 0, wrong: 0, best: 0 }; const next = { correct: row.correct + (delta.correct ?? 0), wrong: row.wrong + (delta.wrong ?? 0), best: Math.max(row.best, delta.streak ?? 0) }; users.set(id, next); return { user_id: id, ...next }; },
    rememberRole: async (_g, id, roleId, removeAt) => { kept.set(id, { role_id: roleId, remove_at: removeAt }); },
    getRole: async (_g, id) => kept.get(id) ?? null,
    forgetRole: async (_g, id) => { kept.delete(id); },
  });
  stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
  const counting = require('../src/events/messageCreateCounting');
  const sent = [];
  const reactions = [];
  const message = (content, author = 'u1', id = `m${Math.random()}`) => ({
    id, content, author: { id: author, bot: false },
    guild: { id: 'g1', members: { me: {} } },
    channel: { id: 'c1', permissionsFor: () => ({ has: () => false }), send: async (payload) => { sent.push(JSON.stringify(payload.components?.map((c) => c.toJSON?.() ?? c))); } },
    react: async (emoji) => { reactions.push(emoji); },
    delete: async () => {},
  });
  await counting.execute(message('1', 'u1', 'a'));
  await counting.execute(message('2', 'u2', 'b'));
  assert.equal(config.current_number, 2);
  assert.equal(config.last_user_id, 'u2');
  assert.deepEqual(reactions, ['✅', '✅'], 'a record gets its reaction only on the step of the server, not on every number');
  await counting.execute(message('hello there', 'u3'));
  assert.equal(config.current_number, 2, 'chat is left alone');
  await counting.execute(message('3', 'u2'));
  assert.equal(config.current_number, 2, 'the same person twice is not counted');
  assert.ok(sent.at(-1).includes('two numbers in a row'));
  await counting.execute(message('9', 'u3'));
  assert.equal(config.current_number, 0, 'a mistake sends the count back');
  assert.ok(sent.at(-1).includes('messed up at **2**'));
  assert.equal(users.get('u3').wrong, 1);
  // The record reaction: only when the number is a record and falls on the step (every record_every).
  config = { ...config, current_number: 99, last_user_id: null, high_score: 98, record_every: 100 };
  reactions.length = 0;
  await counting.execute(message('100', 'u8', 'rec1'));
  assert.deepEqual(reactions, ['🏆'], 'number 100 is a record on the step');
  reactions.length = 0;
  await counting.execute(message('101', 'u9', 'rec2'));
  assert.deepEqual(reactions, ['✅'], 'the next one is a record too, but off the step');
  config = { ...config, record_every: 0, current_number: 199, last_user_id: null, high_score: 150 };
  reactions.length = 0;
  await counting.execute(message('200', 'u8', 'rec3'));
  assert.deepEqual(reactions, ['✅'], 'with 0 the record reaction is off');
  config = { ...config, current_number: 0, last_user_id: null, record_every: 100 };

  // Two people at once: only one is right.
  await Promise.all([counting.execute(message('1', 'u4')), counting.execute(message('1', 'u5'))]);
  assert.equal(users.get('u4').correct, 1, 'the first one counted');
  assert.equal(users.get('u5').wrong, 1, 'and the second 1 is wrong, because the first one had counted already');
  assert.equal(config.current_number, 0);

  // Roles: the one for a mistake (for a time, or until the next right number) and the one of the best counter.
  const roles = new Map();
  const make = (id) => ({ id, editable: true });
  const members = new Map();
  const memberOf = (id) => {
    if (!members.has(id)) members.set(id, { id, roles: { add: async (role) => { roles.set(`${id}:${role.id ?? role}`, true); }, remove: async (role) => { roles.delete(`${id}:${role.id ?? role}`); return {}; } } });
    return members.get(id);
  };
  const withRoles = (content, author, id) => {
    const m = message(content, author, id);
    m.member = memberOf(author);
    m.guild = { id: 'g1', members: { me: {}, fetch: async (uid) => memberOf(uid) }, roles: { cache: new Map([['wrong', make('wrong')], ['top', make('top')]]) } };
    return m;
  };
  config = { ...config, current_number: 0, last_user_id: null, high_score: 0, wrong_role_id: 'wrong', wrong_role_minutes: 60, top_role_id: 'top', top_user_id: null, top_correct: 0, alert_seconds: 0 };
  users.clear();
  const say = async (n, who, id) => counting.execute(withRoles(String(n), who, id || `m${n}${who}${Math.random()}`));
  await say(1, 'a1');
  assert.equal(config.top_user_id, 'a1', 'the first one to count is the best counter');
  assert.ok(roles.has('a1:top'), 'and gets the role');
  for (const [n, who] of [[2, 'a2'], [3, 'a1'], [4, 'a2'], [5, 'a1']]) await say(n, who);
  assert.deepEqual([users.get('a1').correct, users.get('a2').correct], [3, 2]);
  await say(6, 'a2');
  assert.equal(config.top_user_id, 'a1', 'a tie does not take the place');
  await say(7, 'a1');
  await say(8, 'a2');
  assert.deepEqual([users.get('a1').correct, users.get('a2').correct], [4, 4]);
  assert.equal(config.top_user_id, 'a1');
  await say(20, 'a1');
  assert.ok(roles.has('a1:wrong'), 'who gets a number wrong gets the mistake role');
  assert.ok(kept.get('a1').remove_at instanceof Date, 'for the time the server chose');
  assert.equal(config.current_number, 0);
  // Passing the lead moves the role of the best counter.
  await say(1, 'a2');
  assert.equal(users.get('a2').correct, 5);
  assert.equal(config.top_user_id, 'a2', 'the one with more right numbers is the best counter');
  assert.ok(roles.has('a2:top') && !roles.has('a1:top'), 'the role moved');
  // A mistake role that lasts until the next right number ends with it.
  config = { ...config, wrong_role_minutes: 0, current_number: 0, last_user_id: null };
  roles.clear(); kept.clear();
  await counting.execute(withRoles('5', 'b1', 'w1'));
  assert.ok(roles.has('b1:wrong') && kept.get('b1').remove_at === null, 'no time: it stays');
  await counting.execute(withRoles('1', 'b2', 'w2'));
  await counting.execute(withRoles('2', 'b1', 'w3'));
  assert.ok(!roles.has('b1:wrong') && !kept.has('b1'), 'a right number takes it back');
  // The answers are in the language of the server.
  config = { ...config, current_number: 4, last_user_id: 'es1', allow_double: false };
  await counting.check(message('5', 'es1'), 'es');
  assert.ok(sent.at(-1).includes('no puedes contar dos números seguidos'), 'the same person twice, in Spanish');
  config = { ...config, current_number: 4, last_user_id: null, saves: 0 };
  await counting.check(message('9', 'pt1'), 'pt-BR');
  assert.ok(sent.at(-1).includes('errou em **4**'), 'a mistake, in Portuguese');
  // Alerts delete themselves after the time of the server.
  const { deleteLater } = require('../src/utils/counting');
  let gone = 0;
  deleteLater({ delete: async () => { gone += 1; } }, 0);
  assert.equal(gone, 0, '0 means never');
  console.log('counting ok');
})().catch((error) => { console.error(error); process.exit(1); });

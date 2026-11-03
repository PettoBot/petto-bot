// `!mute @member 3d spam` and `!ban @member 7d spam` are temporary with no `temp` word, and so is the slash form with its `duration` option.
// This checks the part that decides it (splitLeadingDuration), the interaction that hands the duration to the temporary command (withOptionValues) and that
// the options exist. How the words after the member are read by the prefix is checked in check-mod-command.js.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { looksLikeDuration, splitLeadingDuration } = require('../src/utils/duration');
const { withOptionValues } = require('../src/utils/optionOverrides');

// A length of time is a word with a unit; a plain number is not one (it is the days of messages in `!ban @x 7 spam`).
for (const word of ['3d', '12h', '1h30m', '2w', '10m', '1.5h', '2semanas', '3días', '1mo']) assert.ok(looksLikeDuration(word), `${word} is a duration`);
for (const word of ['7', '3', 'spam', 'd', '3x', '', '1h30', '99999999999999999999999999999999999999999999999999999999999999999d', null, undefined]) assert.ok(!looksLikeDuration(word), `${String(word)} is not a duration`);

const split = (d, r) => splitLeadingDuration(d, r);
assert.deepEqual(split(null, '3d'), { duration: '3d', reason: null });
assert.deepEqual(split(null, '3d spam now'), { duration: '3d', reason: 'spam now' });
assert.deepEqual(split('3d', 'spam'), { duration: '3d', reason: 'spam' }, 'the duration option, as the prefix reader and a slash command give it');
assert.deepEqual(split('1h30m', null), { duration: '1h30m', reason: null });
assert.deepEqual(split(null, 'spam'), { duration: null, reason: 'spam' }, 'no time: permanent, the reason as it was');
assert.deepEqual(split(null, null), { duration: null, reason: null });
assert.deepEqual(split(null, '7'), { duration: null, reason: '7' }, 'a plain number is not a time');
assert.deepEqual(split('5', 'times in a row'), { duration: null, reason: '5 times in a row' }, 'a number the prefix reader took as the duration goes back to the front of the reason');
assert.deepEqual(split('spam', 'again'), { duration: null, reason: 'spam again' }, 'a word that is not a time is never lost');
assert.deepEqual(split(null, 'spam 3d'), { duration: null, reason: 'spam 3d' }, 'only the first word can be the time');
assert.deepEqual(split('   ', '  2d   rude  '), { duration: '2d', reason: 'rude' }, 'spaces around do not matter');

// The interaction the temporary command gets: the same one, with the duration and the reason it needs.
const calls = [];
const real = {
  replied: false,
  options: {
    getString: (name, required) => { calls.push(['string', name, required]); return { reason: 'original', other: 'x' }[name] ?? null; },
    getUser: (name) => ({ id: `user:${name}` }),
    getInteger: () => 5,
  },
  async reply(payload) { this.replied = true; return payload; },
};
const wrapped = withOptionValues(real, { duration: '3d', reason: 'spam' });
assert.equal(wrapped.options.getString('duration', true), '3d');
assert.equal(wrapped.options.getString('reason'), 'spam');
assert.equal(wrapped.options.getString('other'), 'x', 'the other options are the real ones');
assert.deepEqual(wrapped.options.getUser('user', true), { id: 'user:user' });
assert.equal(wrapped.options.getInteger('delete_message_days'), 5);
assert.throws(() => withOptionValues(real, { duration: null }).options.getString('duration', true), /Missing option/, 'a required option with no value is an error, as in a slash command');
assert.equal(withOptionValues(real, { reason: null }).options.getString('reason'), null, 'a reason that is gone is null');
{
  const result = wrapped.reply({ content: 'hi' });
  assert.ok(result && real.replied === true, 'what the wrapped interaction does is seen by the real one');
}

// The commands take the option, and a hard ban is not temporary.
const mute = require('../src/commands/moderation/mute').data.toJSON();
const ban = require('../src/commands/moderation/ban').data.toJSON();
const sub = (command, name) => command.options.find((option) => option.name === name);
const names = (node) => node.options.map((option) => `${option.name}:${Boolean(option.required)}`);
assert.deepEqual(names(sub(mute, 'user')), ['user:true', 'duration:false', 'reason:false'], 'mute user: the duration comes before the reason, so the words after the member are read as time first');
assert.deepEqual(names(sub(ban, 'user')), ['user:true', 'delete_message_days:false', 'duration:false', 'reason:false'], 'ban user: the days of messages come first (as in `!ban @x 7 spam`), then the duration');
assert.deepEqual(names(sub(mute, 'temp')), ['user:true', 'duration:true', 'reason:false'], 'the temp subcommands stay as they were');
assert.deepEqual(names(sub(ban, 'temp')), ['user:true', 'duration:true', 'delete_message_days:false', 'reason:false']);
console.log('check-timed-sanctions: ok');

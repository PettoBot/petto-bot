// A button, menu or form that can be slow is acknowledged to Discord first, so a slow moment does not turn into "This interaction failed" and
// an "Unknown interaction" error: the helpers, and the VoiceMaster handlers that use them.
const assert = require('node:assert/strict');
const path = require('node:path');

const stub = (relative, exports) => { const file = require.resolve(path.join(__dirname, '..', relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
const order = [];
stub('src/db/voiceMaster.js', { getTemp: async () => null });
stub('src/commands/automation/voicemaster.js', { executeAction: async (interaction) => { order.push('action'); return interaction.answered; } });
stub('src/i18n/index.js', { t: (_lang, key) => key, languageOf: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); order.push('language'); return 'en'; } });
const { ack, answer } = require('../src/utils/interactionAck');
const { handleButton, handleModal, handleSelect } = require('../src/interactions/voiceMaster');

const fake = (extra = {}) => {
  const calls = [];
  const interaction = {
    deferred: false, replied: false, calls,
    customId: 'vc:lock', user: { id: 'u1' }, guild: { voiceStates: { cache: new Map() } }, member: { voice: { channelId: null } },
    deferReply: async (options) => { calls.push(['defer', options]); interaction.deferred = true; },
    editReply: async (payload) => { calls.push(['edit', payload]); interaction.replied = true; },
    followUp: async (payload) => { calls.push(['followUp', payload]); },
    reply: async (payload) => { calls.push(['reply', payload]); interaction.replied = true; },
    showModal: async () => { calls.push(['modal']); },
    ...extra,
  };
  return interaction;
};

(async () => {
  // The helpers.
  let i = fake();
  assert.equal(await ack(i), true);
  assert.deepEqual(i.calls[0], ['defer', { flags: 64 }], 'it is announced as a private answer');
  await ack(i);
  assert.equal(i.calls.filter(([kind]) => kind === 'defer').length, 1, 'it is announced once');
  await answer(i, { content: 'done', flags: 64 });
  assert.deepEqual(i.calls[1], ['edit', { content: 'done' }], 'the announced answer is filled in, without flags (they were set when it was announced)');
  await answer(i, { content: 'more', flags: 64 });
  assert.equal(i.calls[2][0], 'followUp', 'a second thing goes as a follow-up');
  i = fake();
  await answer(i, { content: 'first', flags: 64 });
  assert.equal(i.calls[0][0], 'reply', 'with nothing announced it answers as before');
  i = fake({ deferReply: async () => { throw Object.assign(new Error('Unknown interaction'), { code: 10062 }); } });
  assert.equal(await ack(i), false, 'a late one is said quietly');
  i = fake({ deferReply: async () => { throw Object.assign(new Error('boom'), { code: 500 }); } });
  await assert.rejects(() => ack(i), /boom/, 'any other error is still an error');

  // VoiceMaster: Discord is told before anything slow.
  i = fake();
  order.length = 0;
  i.deferReply = async () => { order.push('defer'); i.deferred = true; };
  await handleButton(i);
  assert.deepEqual(order, ['defer', 'language', 'action'], 'a button is announced before the language is read');
  i = fake({ customId: 'vc:rename' });
  await handleButton(i);
  assert.ok(i.calls.some(([kind]) => kind === 'modal') || i.calls.some(([kind]) => kind === 'reply'), 'the rename form is not announced (it has to be the first answer)');
  assert.ok(!i.calls.some(([kind]) => kind === 'defer'), 'no defer before a form');
  i = fake({ customId: 'vm_modal_rename', fields: { getTextInputValue: () => 'name' } });
  await handleModal(i);
  assert.equal(i.calls[0][0], 'defer', 'a submitted form is announced');
  i = fake({ customId: 'vc:do_permit::123', values: ['x'] });
  await handleSelect(i);
  assert.equal(i.calls[0][0], 'defer', 'a menu is announced');
  i = fake({ customId: 'unrelated' });
  await handleSelect(i);
  assert.equal(i.calls.length, 0, 'what is not theirs is left alone');
  i = fake({ deferReply: async () => { throw Object.assign(new Error('Unknown interaction'), { code: 10062 }); } });
  await handleButton(i);
  assert.equal(i.calls.length, 0, 'a button that came too late does nothing and raises no error');
  console.log('Checked that slow buttons, menus and forms are acknowledged to Discord first.');
})().catch((error) => { console.error(error); process.exit(1); });

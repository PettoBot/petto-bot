const assert = require('node:assert/strict');
const path = require('node:path');

function stub(rel, exports) {
  const resolved = require.resolve(path.join('..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const saved = [];
stub('src/db/database', { from: () => ({}) });
stub('src/db/ticketForms', {
  normalizeFields: (fields) => fields,
  createForm: async (form) => { saved.push(form); return { name: form.name }; },
  updateForm: async (guildId, name, patch) => { saved.push({ guildId, name, ...patch }); return { name }; },
});

const panel = require('../src/interactions/ticketFormPanel');

function modalInteraction(customId, values) {
  const calls = [];
  return {
    calls,
    customId,
    user: { id: 'u1' },
    memberPermissions: { has: () => true },
    fields: { getTextInputValue: (id) => values[id] ?? '' },
    deferUpdate: async () => calls.push('defer'),
    editReply: async (payload) => calls.push(payload),
    reply: async (payload) => calls.push({ reply: payload }),
  };
}

(async () => {
  panel.startDraft('u1', { guildId: 'g1', mode: 'create', name: 'support' });

  const first = modalInteraction('tfm_long::u1', { label: 'What happened?', hint: 'Describe it', required: '' });
  await panel.handleModal(first);
  const second = modalInteraction('tfm_short::u1', { label: 'Optional note', hint: '', required: 'no' });
  await panel.handleModal(second);
  assert.ok(first.calls.some((c) => c && c.components), 'the panel is redrawn after adding a question');

  const save = {
    customId: 'tf_save::u1',
    user: { id: 'u1' },
    memberPermissions: { has: () => true },
    deferUpdate: async () => {},
    editReply: async () => {},
    followUp: async (p) => { throw new Error(`unexpected: ${p.content}`); },
  };
  await panel.handleButton(save);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].fields.map((f) => [f.type, f.label, f.required]), [['long_text', 'What happened?', true], ['short_text', 'Optional note', false]]);

  const stranger = modalInteraction('tfm_short::u1', { label: 'x' });
  stranger.user = { id: 'u2' };
  await panel.handleModal(stranger);
  assert.ok(stranger.calls[0].reply, 'someone else cannot use the panel');

  console.log('Checked the ticket form builder: questions added, saved and protected.');
})().catch((err) => { console.error(err); process.exit(1); });

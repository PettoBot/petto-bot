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

  // The new kinds of question: every one has its window (Discord forms with labels, radio buttons, checkboxes and a menu), and the answer becomes
  // a stored question that the form can use.
  const { ComponentType } = require('discord.js');
  const buttons = (panelPayload) => panelPayload.components.flatMap((component) => component.components ?? []).map((component) => component.toJSON?.().custom_id).filter(Boolean);
  panel.startDraft('u2', { guildId: 'g1', mode: 'create', name: 'support' });
  const draft = panel.renderPanel('u2', { guildId: 'g1', mode: 'create', name: 'support', title: 'T', fields: [] });
  assert.deepEqual(buttons(draft).filter((id) => id.startsWith('tf_add')), ['tf_add_short::u2', 'tf_add_long::u2', 'tf_add_choice::u2', 'tf_add_file::u2', 'tf_add_pick::u2', 'tf_add_info::u2']);
  const windows = {};
  for (const type of ['tf_add_choice', 'tf_add_file', 'tf_add_pick', 'tf_add_info']) {
    const click = { customId: `${type}::u2`, user: { id: 'u2' }, memberPermissions: { has: () => true }, showModal: async (modal) => { windows[type] = modal.toJSON(); }, reply: async () => {} };
    await panel.handleButton(click);
    assert.ok(windows[type].components.length >= 1 && windows[type].components.length <= 5, `${type}: a window of 1 to 5 parts`);
    assert.ok(windows[type].components.every((part) => part.type === 18 && part.label.length <= 45), `${type}: every part has a label of up to 45 characters`);
    assert.ok(windows[type].title.length <= 45);
  }
  assert.deepEqual(windows.tf_add_choice.components.map((part) => part.component.type), [ComponentType.TextInput, ComponentType.TextInput, ComponentType.RadioGroup, ComponentType.Checkbox, ComponentType.Checkbox]);
  assert.deepEqual(windows.tf_add_file.components.map((part) => part.component.type), [ComponentType.TextInput, ComponentType.RadioGroup, ComponentType.StringSelect, ComponentType.Checkbox]);
  assert.deepEqual(windows.tf_add_file.components[2].component.options.map((option) => option.value), ['1', '2', '3', '4', '5'], 'one to five files');

  const answerWindow = (customId, values) => {
    const calls = [];
    return {
      calls,
      customId,
      user: { id: 'u2' },
      memberPermissions: { has: () => true },
      fields: {
        getTextInputValue: (id) => values[id] ?? '',
        getRadioGroup: (id) => values[id] ?? null,
        getCheckbox: (id) => values[id] === true,
        getStringSelectValues: (id) => (values[id] === undefined ? [] : [values[id]]),
      },
      deferUpdate: async () => calls.push('defer'),
      editReply: async (payload) => calls.push(payload),
      reply: async (payload) => calls.push({ reply: payload }),
    };
  };
  const stored2 = [];
  saved.length = 0;
  for (const [id, values] of [
    ['tfm_choice::u2', { label: 'Topic', options: 'Billing\nBug\nOther', kind: 'select', many: true, required: true }],
    ['tfm_choice::u2', { label: 'Urgent?', options: 'Yes\nNo', kind: 'radio', required: false }],
    ['tfm_file::u2', { label: 'Screenshot', accept: 'images', max: '3', required: true }],
    ['tfm_pick::u2', { label: 'Which member?', kind: 'user', required: false }],
    ['tfm_info::u2', { content: 'Read the **rules** first.' }],
  ]) {
    const done = answerWindow(id, values);
    await panel.handleModal(done);
    stored2.push(done);
    assert.ok(done.calls.some((c) => c && c.components), `${id} redraws the panel`);
  }
  const listing = stored2.at(-1).calls.find((c) => c && c.components).components[0].toJSON().components[0].content;
  assert.ok(listing.includes('Dropdown menu · up to 3 of 3 choices') && listing.includes('Radio buttons · 2 choices') && listing.includes('pictures only · up to 3') && listing.includes('Member picker') && listing.includes('Text only'), listing);
  assert.ok(!listing.includes('**Urgent?** *') && listing.includes('**Topic** *'), 'the required ones are marked');
  const full = answerWindow('tfm_choice::u2', { label: 'One more', options: 'a\nb', kind: 'select', required: true });
  await panel.handleModal(full);
  assert.ok(full.calls[0].reply && full.calls[0].reply.content.includes('up to 5'), 'a form holds at most 5 questions');

  // Saving goes through the real checks (the stub of the first part replaced by the real ones).
  const realFields = require('../src/utils/ticketFormFields');
  panel.startDraft('u3', { guildId: 'g1', mode: 'create', name: 'x' });
  const lone = answerWindow('tfm_info::u3', { content: 'Only a text' });
  lone.user = { id: 'u3' };
  await panel.handleModal(lone);
  assert.throws(() => realFields.normalizeFields([{ type: 'display', content: 'Only a text' }]), /at least one question/, 'a form with only a text cannot be saved');
  const bad = answerWindow('tfm_choice::u2', { label: 'Broken', options: '', kind: 'select', required: true });
  panel.startDraft('u2', { guildId: 'g1', mode: 'create', name: 'support' });
  await panel.handleModal(bad);
  assert.ok(bad.calls[0].reply && /1 to 25 choices/.test(bad.calls[0].reply.content), 'a question with no choices says what is wrong');

  console.log('Checked the ticket form builder: questions added (text, choices, files, pickers, texts), saved and protected.');
})().catch((err) => { console.error(err); process.exit(1); });

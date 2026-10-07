// Checks the guided ticket setup: choices, validation, publishing and the rollback when posting fails.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const created = { panels: [], categories: [], settings: [], deleted: [] };
stub('src/db/database', { from: () => ({}) });
stub('src/db/guilds', { ensureGuild: async () => ({}) });
stub('src/db/tickets', {
  createPanel: async (p) => { created.panels.push(p); return { id: 7, ...p }; },
  setPanelMessageId: async () => {},
  listCategories: async () => [{ key: 'support' }],
  createCategory: async (c) => { created.categories.push(c); return { key: c.key, label: c.label, emoji: c.emoji, description: c.description, button_style: c.buttonStyle }; },
  deleteCategory: async (g, key) => { created.deleted.push(`category:${key}`); },
  deletePanel: async (g, id) => { created.deleted.push(`panel:${id}`); },
});
stub('src/db/ticketSettings', { upsertSettings: async (g, patch) => { created.settings.push(patch); } });

const wizard = require('../src/interactions/ticketSetupWizard');

function makeGuild(canPost = true, sendFails = false) {
  const sent = [];
  const channel = {
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => canPost }),
    send: async (payload) => { if (sendFails) throw new Error('Missing Access'); sent.push(payload); return { id: 'm1' }; },
  };
  return { sent, guild: { id: 'g1', members: { me: {} }, channels: { fetch: async () => channel } } };
}

function interaction(customId, { fields: modalFields, ...extra } = {}) {
  const calls = [];
  return {
    calls,
    customId,
    user: { id: 'u1' },
    memberPermissions: { has: () => true },
    values: [],
    fields: { getTextInputValue: (id) => (modalFields ?? {})[id] ?? '' },
    update: async (p) => calls.push({ update: p }),
    deferUpdate: async () => calls.push('defer'),
    editReply: async (p) => calls.push({ edit: p }),
    followUp: async (p) => calls.push({ followUp: p }),
    reply: async (p) => calls.push({ reply: p }),
    showModal: async (m) => calls.push({ modal: m }),
    ...extra,
  };
}

(async () => {
  const draft = wizard.startDraft('u1', { guildId: 'g1', channelId: null });

  // Publishing needs a channel and a support role first.
  const early = interaction('tfw_publish::u1', { guild: makeGuild().guild });
  await wizard.handleButton(early);
  assert.match(early.calls[0].reply.content, /choose the panel channel and choose at least one support role/);

  const channelPick = interaction('tfw_channel::u1', { values: ['c1'] });
  await wizard.handleSelect(channelPick);
  const rolesPick = interaction('tfw_roles::u1', { values: ['r1', 'r2'] });
  await wizard.handleSelect(rolesPick);
  const logPick = interaction('tfw_log::u1', { values: ['c2'] });
  await wizard.handleSelect(logPick);
  assert.equal(draft.channelId, 'c1');
  assert.deepEqual(draft.supportRoleIds, ['r1', 'r2']);

  // Types, color and style.
  await wizard.handleModal(interaction('tfwm_type::u1', { fields: { label: 'Report a player', emoji: '🚨', description: 'Break the rules' } }));
  await wizard.handleModal(interaction('tfwm_type::u1', { fields: { label: 'Support', emoji: '', description: '' } }));
  assert.deepEqual(draft.types.map((t) => t.label), ['Support', 'Report a player', 'Support']);
  const badEmoji = interaction('tfwm_type::u1', { fields: { label: 'Bad', emoji: 'notanemoji' } });
  await wizard.handleModal(badEmoji);
  assert.match(badEmoji.calls[0].reply.content, /not an emoji/);
  assert.equal(draft.types.length, 3);
  await wizard.handleButton(interaction('tfw_color::u1'));
  assert.equal(draft.buttonStyle, 'secondary');
  await wizard.handleButton(interaction('tfw_remove::u1'));
  assert.equal(draft.types.length, 2);

  // Someone else cannot touch it.
  const stranger = interaction('tfw_color::u1');
  stranger.user = { id: 'u2' };
  await wizard.handleButton(stranger);
  assert.ok(stranger.calls[0].reply, 'another user is refused');

  // Publishing: panel, one category per type with unique keys, log channel and the message.
  const ok = makeGuild();
  const publish = interaction('tfw_publish::u1', { guild: ok.guild });
  await wizard.handleButton(publish);
  assert.equal(created.panels.length, 1);
  assert.deepEqual(created.categories.map((c) => c.key), ['support-2', 'report-a-player']);
  assert.ok(created.categories.every((c) => c.buttonStyle === 'secondary' && c.supportRoleIds.length === 2));
  assert.deepEqual(created.settings[0], { opened_log_channel_id: 'c2', closed_log_channel_id: 'c2' });
  assert.equal(ok.sent.length, 1);
  assert.ok(publish.calls.some((c) => c.edit));

  // If the panel cannot be posted, nothing stays behind.
  created.panels.length = 0;
  created.categories.length = 0;
  wizard.startDraft('u1', { guildId: 'g1', channelId: 'c1' }).supportRoleIds.push('r1');
  const bad = makeGuild(true, true);
  const failed = interaction('tfw_publish::u1', { guild: bad.guild });
  await wizard.handleButton(failed);
  assert.ok(created.deleted.includes('panel:7'), 'the panel is removed again');
  assert.ok(failed.calls.some((c) => c.followUp && /nothing was kept/.test(c.followUp.content)));

  assert.equal(wizard.isValidEmoji('🎫'), true);
  assert.equal(wizard.isValidEmoji('<:pe_Alert:1555688656876867726>'), true);
  assert.equal(wizard.isValidEmoji('abc'), false);

  console.log('Checked the ticket setup wizard: choices, validation, publishing and rollback.');
})().catch((err) => { console.error(err); process.exit(1); });

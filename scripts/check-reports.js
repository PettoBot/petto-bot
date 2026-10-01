// Checks the pure parts of the report system without a database: that every report card fits Discord's limits in
// every status, that anonymous reports never name the reporter, and that button ids round-trip.
const assert = require('node:assert/strict');
const path = require('node:path');

// The database module is replaced so this runs without a database or any environment variables.
const databaseModule = require.resolve(path.join(__dirname, '..', 'src', 'db', 'report.js'));
require.cache[databaseModule] = { id: databaseModule, filename: databaseModule, loaded: true, exports: {} };

const { REPORT_CATEGORIES, categoryLabel, isReportCategory, DEFAULT_CATEGORY } = require('../src/utils/reportCategories');
const { buildReportCard, buildReportPayload, reportButtonId, REPORT_BUTTON_PREFIX } = require('../src/utils/reportCard');
const { parseButton, parseReasonModal, buildReasonModal, TRANSITIONS, NEEDS_REASON } = require('../src/interactions/reportActions');
const { parseListButton } = require('../src/utils/reportViews');
const { readOptionalCheckbox, buildReportModal } = require('../src/interactions/reportModal');

assert.ok(isReportCategory(DEFAULT_CATEGORY));
assert.equal(new Set(REPORT_CATEGORIES.map((category) => category.value)).size, REPORT_CATEGORIES.length, 'category values must be unique');
assert.ok(REPORT_CATEGORIES.length <= 25, 'a select menu holds at most 25 options');
for (const category of REPORT_CATEGORIES) {
  assert.ok(category.label.length <= 100 && category.description.length <= 100, `category ${category.value} exceeds the option limits`);
  assert.equal(categoryLabel(category.value), category.label);
}
assert.equal(categoryLabel('nonsense'), categoryLabel(DEFAULT_CATEGORY));

function inspect(card) {
  const json = card.toJSON();
  let components = 0;
  let chars = 0;
  let buttons = 0;
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'number') components += 1;
    if (node.type === 10) {
      chars += node.content.length;
      assert.ok(node.content.trim(), 'a card must not contain an empty text block');
    }
    if (node.type === 2) buttons += 1;
    Object.values(node).forEach(walk);
  })(json);
  return { components, chars, buttons, text: JSON.stringify(json) };
}

const longText = 'x'.repeat(5000);
const base = {
  report_number: 123456,
  reporter_id: '111111111111111111',
  reported_user_id: '222222222222222222',
  category: 'scam',
  reason: longText,
  source_channel_id: '333333333333333333',
  message_link: 'https://discord.com/channels/1/2/3',
  message_content: longText,
  image_urls: Array.from({ length: 14 }, (_, index) => `https://cdn.example.com/${index}.png`),
  anonymous: false,
  urgent: true,
  status: 'open',
  handled_by: '444444444444444444',
  handled_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

for (const status of ['open', 'claimed', 'resolved', 'dismissed']) {
  for (const urgent of [true, false]) {
    const stats = inspect(buildReportCard({ ...base, status, urgent }, { pingRoleIds: ['555555555555555555', '666666666666666666'] }));
    assert.ok(stats.components <= 40, `${status} card has ${stats.components} components`);
    assert.ok(stats.chars <= 4000, `${status} card has ${stats.chars} characters`);
    assert.ok(stats.buttons <= 5, `${status} card has ${stats.buttons} buttons`);
  }
}

const anonymous = inspect(buildReportCard({ ...base, anonymous: true }));
assert.ok(!anonymous.text.includes(base.reporter_id), 'an anonymous report must not contain the reporter id');
assert.ok(anonymous.text.includes('Anonymous'));

const payload = buildReportPayload(base, { pingRoleIds: ['555555555555555555'] });
assert.deepEqual(payload.allowedMentions, { parse: [], roles: ['555555555555555555'] });
assert.deepEqual(buildReportPayload(base).allowedMentions, { parse: [] }, 'an edit must not ping anyone');

// Button ids round-trip, and every action has a start and an end status.
for (const action of Object.keys(TRANSITIONS)) {
  const id = reportButtonId(action, 42);
  assert.ok(id.startsWith(REPORT_BUTTON_PREFIX) && id.length <= 100);
  assert.deepEqual(parseButton(id), { action, reportNumber: 42 });
}
assert.equal(parseButton('rpt:explode:1'), null);
assert.equal(parseButton('rpt:claim:abc'), null);
assert.deepEqual(parseListButton('rptl:open:2:0'), { status: 'open', page: 2, userId: null });
assert.deepEqual(parseListButton('rptl:all:0:123456789012345678'), { status: 'all', page: 0, userId: '123456789012345678' });
assert.equal(parseListButton('rptl:bogus:0:0'), null);

// The form only has the ping and anonymous checkboxes when the server turned them on. Reading a field that is not
// there throws in discord.js, which broke every report from a server without those options.
const missingField = (customId) => Object.assign(new Error(`Required field with custom id "${customId}" not found.`), { code: 'ModalSubmitInteractionFieldNotFound' });
const formWithout = { getCheckbox: (customId) => { throw missingField(customId); } };
assert.equal(readOptionalCheckbox(formWithout, 'report_ping'), false, 'a checkbox that is not in the form is not ticked');
assert.equal(readOptionalCheckbox(formWithout, 'report_anonymous'), false);
assert.equal(readOptionalCheckbox({ getCheckbox: () => true }, 'report_ping'), true);
assert.equal(readOptionalCheckbox({ getCheckbox: () => false }, 'report_ping'), false);
assert.equal(readOptionalCheckbox({ getCheckbox: () => null }, 'report_ping'), false);

// The form really leaves the checkboxes out unless the server enabled them.
const checkboxIds = (config) => JSON.stringify(buildReportModal({ customId: 'rp_usr::1', title: 'Report', intro: 'x', config }).toJSON()).match(/report_(?:ping|anonymous)/g) ?? [];
assert.deepEqual(checkboxIds({}), []);
assert.deepEqual(checkboxIds({ urgent_role_id: '1' }), ['report_ping']);
assert.deepEqual(checkboxIds({ anonymous_reporting_enabled: true }), ['report_anonymous']);
assert.deepEqual(checkboxIds({ urgent_role_id: '1', anonymous_reporting_enabled: true }).sort(), ['report_anonymous', 'report_ping']);

// Which buttons staff get: closing needs a reason, and inviting the reporter needs a thread and a named reporter.
const labelsOf = (row) => {
  const labels = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 2) labels.push(`${node.label}${node.disabled ? '(disabled)' : ''}`);
    Object.values(node).forEach(walk);
  })(buildReportCard(row).toJSON());
  return labels;
};
const withThread = { ...base, thread_id: '777', reporter_invited_at: null, resolution_note: null };
assert.deepEqual(labelsOf({ ...withThread, status: 'open' }), ['Claim', 'Resolve', 'Dismiss', 'Invite reporter']);
assert.deepEqual(labelsOf({ ...withThread, status: 'claimed' }), ['Resolve', 'Dismiss', 'Release', 'Invite reporter']);
assert.deepEqual(labelsOf({ ...withThread, status: 'open', thread_id: null }), ['Claim', 'Resolve', 'Dismiss'], 'no thread, no invite');
assert.deepEqual(labelsOf({ ...withThread, status: 'open', anonymous: true }), ['Claim', 'Resolve', 'Dismiss'], 'an anonymous reporter is never invited');
assert.deepEqual(labelsOf({ ...withThread, status: 'claimed', reporter_invited_at: new Date().toISOString() }), ['Resolve', 'Dismiss', 'Release', 'Reporter invited(disabled)']);
assert.deepEqual(labelsOf({ ...withThread, status: 'resolved' }), ['Reopen'], 'a closed report can only be reopened');
assert.deepEqual(labelsOf({ ...withThread, status: 'dismissed' }), ['Reopen']);

// The reason of a closed report is on the card, and a very long one still fits.
const note = 'because '.repeat(200);
const resolved = inspect(buildReportCard({ ...withThread, status: 'resolved', resolution_note: note, reason: longText, message_content: longText }));
assert.ok(resolved.text.includes('Reason:') && resolved.chars <= 4000 && resolved.components <= 40);
assert.ok(!inspect(buildReportCard({ ...withThread, status: 'open', resolution_note: 'stale' })).text.includes('stale'), 'a note is only shown while the report is closed');

// Only resolve and dismiss ask for a reason, in a required field.
assert.deepEqual([...NEEDS_REASON].sort(), ['dismiss', 'resolve']);
assert.deepEqual(parseButton('rpt:invite:12'), { action: 'invite', reportNumber: 12 });
assert.deepEqual(parseReasonModal('rptr:resolve:5'), { action: 'resolve', reportNumber: 5 });
assert.equal(parseReasonModal('rptr:claim:5'), null);
assert.equal(parseReasonModal('rptr:resolve:five'), null);
for (const action of NEEDS_REASON) {
  const modal = buildReasonModal(action, 123456789).toJSON();
  assert.ok(modal.title.length <= 45 && modal.custom_id.length <= 100);
  const input = modal.components[0].component;
  assert.equal(input.required, true);
  assert.ok(input.min_length >= 1 && input.max_length <= 4000);
}

console.log('Checked the report cards, categories, forms and button ids.');

// `/summary`: the numbers, the busiest hour, the picture and the invite rules (fake and bonus) behind it.
const assert = require('node:assert/strict');
const { buildSummary, bestDay, METRICS } = require('../src/utils/activitySummary');
const { buildSummaryCard } = require('../src/imgutils/summaryCard');
const { isFakeJoin } = require('../src/db/inviteTrackingRules');

const now = new Date('2026-10-10T12:00:00Z');
const channelRows = [
  { day: '2026-10-09', channel_id: 'a', messages: 30, reactions: 2, voice_seconds: 3600 },
  { day: '2026-10-10', channel_id: 'a', messages: 10, reactions: 0, voice_seconds: 0 },
  { day: '2026-10-10', channel_id: 'b', messages: 25, reactions: 1, voice_seconds: 7200 },
  { day: '2026-09-01', channel_id: 'a', messages: 999, reactions: 0, voice_seconds: 0 },
];
const hourlyRows = [
  { day: '2026-10-09', hour: 15, messages: 30, voice_seconds: 0 },
  { day: '2026-10-10', hour: 15, messages: 10, voice_seconds: 0 },
  { day: '2026-10-10', hour: 21, messages: 25, voice_seconds: 10800 },
];
const flowRows = [{ day: '2026-10-09', joins: 4, leaves: 1, invited: 3 }, { day: '2026-10-10', joins: 2, leaves: 5, invited: 0 }];
const memberRows = [
  { day: '2026-10-09', user_id: 'u1', messages: 20, voice_seconds: 0 },
  { day: '2026-10-10', user_id: 'u1', messages: 15, voice_seconds: 0 },
  { day: '2026-10-10', user_id: 'u2', messages: 5, voice_seconds: 3600 },
];

const summary = buildSummary({ days: 3, channelRows, hourlyRows, flowRows, memberRows, now });
assert.deepEqual(summary.days, ['2026-10-08', '2026-10-09', '2026-10-10']);
assert.equal(summary.totals.messages, 65, 'a day outside the range is not counted');
assert.equal(summary.totals.voiceSeconds, 10800);
assert.equal(summary.totals.joins, 6); assert.equal(summary.totals.leaves, 6); assert.equal(summary.totals.invited, 3);
assert.equal(summary.totals.activeMembers, 2);
assert.equal(summary.totals.activeChannels, 2);
assert.deepEqual(summary.peakHour.messages, { hour: 15, value: 40 }, 'the busiest hour adds up the days');
assert.equal(summary.peakHour.voice.hour, 21);
assert.equal(summary.topMembers.messages[0].id, 'u1');
assert.equal(summary.topChannels.messages[0].id, 'a');
assert.deepEqual(bestDay(summary, 'joins'), { day: '2026-10-09', value: 4 });
assert.equal(buildSummary({ days: 2, now }).peakHour.messages, null, 'with no data there is no busiest hour');

for (const metric of METRICS) {
  const png = buildSummaryCard({ guildName: 'Test', days: 3, metric, summary });
  assert.equal(png.subarray(1, 4).toString(), 'PNG', `${metric} draws a picture`);
}
assert.ok(buildSummaryCard({ guildName: 'Empty', days: 7, metric: 'overview', summary: buildSummary({ days: 7, now }) }).length > 1000, 'a server with no data still gets a picture');

const old = Date.now() - 30 * 86_400_000;
assert.equal(isFakeJoin({ accountCreatedAt: old, previousRow: null }), false);
assert.equal(isFakeJoin({ accountCreatedAt: Date.now() - 3_600_000, previousRow: null }), true, 'a new account is a fake join');
assert.equal(isFakeJoin({ accountCreatedAt: old, previousRow: { user_id: '1' } }), true, 'somebody who came back is a fake join');
console.log('Checked the summary numbers, the picture and the fake joins.');

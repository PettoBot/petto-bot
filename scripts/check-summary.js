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

// Sanctions: kinds, who applied them, and the day in Colombia (GMT-5).
const caseRows = [
  { type: 'ban', source: 'moderator', moderator_id: 'm1', user_id: 'u1', created_at: '2026-10-09T15:00:00Z' },
  { type: 'warn', source: 'honeypot', moderator_id: 'bot', user_id: 'u2', created_at: '2026-10-10T02:00:00Z' }, // 21:00 on Oct 9 in Colombia
  { type: 'tempmute', source: 'moderator', moderator_id: 'bot', user_id: 'u2', created_at: '2026-10-10T08:00:00Z' }, // a case by the bot with no source is automatic
  { type: 'unban', source: 'moderator', moderator_id: 'm1', user_id: 'u1', created_at: '2026-10-10T09:00:00Z' },
  { type: 'kick', source: 'automod', moderator_id: 'bot', user_id: 'u3', created_at: '2026-09-01T09:00:00Z' },
];
const withCases = buildSummary({ days: 3, caseRows, botId: 'bot', now });
assert.equal(withCases.sanctions.total, 3, 'an unban is not a sanction and an old case is outside the range');
assert.deepEqual([withCases.sanctions.byGroup.bans, withCases.sanctions.byGroup.warns, withCases.sanctions.byGroup.mutes, withCases.sanctions.byGroup.undone], [1, 1, 1, 1]);
assert.deepEqual(withCases.sanctions.daily, [0, 2, 1], 'the case at 02:00 UTC belongs to the day before in Colombia');
assert.equal(withCases.sanctions.bySource.honeypot, 1); assert.equal(withCases.sanctions.bySource.automod, 1); assert.equal(withCases.sanctions.automatic, 2);
assert.equal(withCases.sanctions.topUsers[0].id, 'u2');
const { botDay, botHour, formatBotTime } = require('../src/utils/botTime');
assert.equal(botDay(new Date('2026-10-10T04:59:00Z')), '2026-10-09'); assert.equal(botDay(new Date('2026-10-10T05:00:00Z')), '2026-10-10');
assert.equal(botHour(new Date('2026-10-10T02:00:00Z')), 21);
assert.match(formatBotTime(new Date('2026-10-10T02:00:00Z')), /9:00 PM GMT-5$/);

// The text under the picture: short lines, the top lists on one line with at most three names, nothing the picture already says.
const { describeSummary } = require('../src/utils/summaryText');
for (const metric of METRICS) {
  const lines = describeSummary(metric, withCases, 3, [{ inviter_id: '9', net: 4 }]);
  assert.ok(Array.isArray(lines) && lines.length <= 4, `${metric}: up to four lines`);
  assert.ok(lines.every((line) => !line.includes('\n')), `${metric}: every line is one line`);
  assert.ok(lines.join('\n').length < 1000, `${metric}: the text is short`);
}
assert.ok(describeSummary('overview', summary, 3, []).some((line) => line.includes('Busiest hour') && line.includes('GMT-5')), 'the busiest hour is under the overview');
assert.ok(describeSummary('messages', summary, 3, []).length <= 4, 'at most four lines');
assert.ok(describeSummary('overview', summary, 3, []).every((line) => /<:pe_|<:pet/.test(line)), 'every line starts with a Petto emoji');
const manyChannels = buildSummary({ days: 3, now, channelRows: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ day: '2026-10-10', channel_id: id, messages: 50 - i, reactions: 0, voice_seconds: 0 })) });
assert.equal((describeSummary('messages', manyChannels, 3, []).find((line) => line.includes('Favorite channels')).match(/<#/g) ?? []).length, 2, 'a list of channels shows two names');

for (const metric of METRICS) {
  const png = buildSummaryCard({ guildName: 'Test', days: 3, metric, summary: withCases });
  assert.equal(png.subarray(1, 4).toString(), 'PNG', `${metric} draws a picture`);
}
assert.ok(buildSummaryCard({ guildName: 'Empty', days: 7, metric: 'overview', summary: buildSummary({ days: 7, now }) }).length > 1000, 'a server with no data still gets a picture');

const old = Date.now() - 30 * 86_400_000;
assert.equal(isFakeJoin({ accountCreatedAt: old, previousRow: null }), false);
assert.equal(isFakeJoin({ accountCreatedAt: Date.now() - 3_600_000, previousRow: null }), true, 'a new account is a fake join');
assert.equal(isFakeJoin({ accountCreatedAt: old, previousRow: { user_id: '1' } }), true, 'somebody who came back is a fake join');
console.log('Checked the summary numbers, the picture and the fake joins.');

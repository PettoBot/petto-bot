"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missionById = exports.MISSIONS = void 0;
exports.startOf = startOf;
exports.endsAt = endsAt;
exports.MISSIONS = [
    { id: 'messages-day-25', period: 'day', kind: 'messages', target: 25, reward: 3 },
    { id: 'messages-day-100', period: 'day', kind: 'messages', target: 100, reward: 6 },
    { id: 'voice-day-30', period: 'day', kind: 'voice', target: 30, reward: 4 },
    { id: 'voice-day-120', period: 'day', kind: 'voice', target: 120, reward: 8 },
    { id: 'messages-week-500', period: 'week', kind: 'messages', target: 500, reward: 20 },
    { id: 'voice-week-600', period: 'week', kind: 'voice', target: 600, reward: 25 },
];
const missionById = (id) => exports.MISSIONS.find((mission) => mission.id === id) ?? null;
exports.missionById = missionById;
const dayOf = (when) => when.toISOString().slice(0, 10);
/** The first day of the period (UTC): the day itself, or the Monday of the week. */
function startOf(period, now) {
    if (period === 'day')
        return dayOf(now);
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return dayOf(monday);
}
/** When the period ends (the start of the next day, or of the next Monday), UTC. */
function endsAt(period, now) {
    const start = new Date(`${startOf(period, now)}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + (period === 'day' ? 1 : 7));
    return start;
}

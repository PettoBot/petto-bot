"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
// i18n-ignore-file: function names stay as they are in every language; the mistakes are phrases.
// More functions of Petto Code that only work on values (no Discord, nothing stored): text, numbers, lists, dates and a few small tools.
// They never change anything, so they have no effects and no limits other than the size of what they make.
const node_crypto_1 = require("node:crypto");
// The time zones are the ones of the timers (`utils/timerSchedule`): hours from UTC, `UTC+5`, or a name like `America/Bogota`.
const { normalizeTimeZone, zoneOffsetMs, zonedTimeToUtc } = require('../utils/timerSchedule');
const MAX_TEXT = 20_000;
const MAX_LIST = 2_000;
const DAY = 86_400;
function register(h) {
    const { def, fail, what, text, num, list, str, isTruthy, equals, FORBIDDEN_KEYS } = h;
    const whole = (value, name, min, max) => {
        const number = Math.trunc(num(value));
        if (number < min || number > max)
            fail('range', { name, min, max });
        return number;
    };
    const numbers = (items) => items.map((item) => num(item));
    /** The zone asked for (hours from UTC, or a name), or the zone of the server: as a name of a zone, or the hours. */
    const zoneOf = (env, zone) => {
        const wanted = zone === undefined || zone === null ? (env.data?.TimeZone ?? 'UTC') : zone;
        if (typeof wanted === 'number' || (typeof wanted === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(wanted))) {
            const hours = num(wanted);
            if (hours < -14 || hours > 14)
                fail('timeZone');
            return { hours };
        }
        const name = normalizeTimeZone(wanted);
        return name ? { name } : fail('timeZone');
    };
    /** The seconds of a time moved to the zone, as if the zone were UTC. */
    const shifted = (env, seconds, zone) => {
        const base = Math.trunc(num(seconds));
        const found = zoneOf(env, zone);
        return 'hours' in found ? base + Math.round(found.hours * 3600) : base + Math.round(zoneOffsetMs(found.name, base * 1000) / 1000);
    };
    // ── Text ─────────────────────────────────────────────────────────────────
    def('wordCount', 1, 1, (env, value) => text(value).split(/\s+/).filter(Boolean).length);
    // The lines of a text, without the empty ones at the ends.
    def('lines', 1, 1, (env, value) => text(value).split(/\r?\n/).slice(0, MAX_LIST));
    // "Hello World!" becomes "hello-world": lowercase, without accents, letters and numbers joined by -.
    def('slug', 1, 1, (env, value) => text(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200));
    def('initials', 1, 2, (env, value, count) => {
        const words = text(value).split(/\s+/).filter(Boolean);
        const wanted = count === undefined ? 2 : whole(count, 'initials', 1, 10);
        return words.slice(0, wanted).map((word) => [...word][0]?.toUpperCase() ?? '').join('');
    });
    // A bar for a number: `bar 7 10 10` is ███████░░░ (the width is 1 to 40, 10 when it is not said).
    def('bar', 2, 3, (env, value, max, width) => {
        const size = width === undefined ? 10 : whole(width, 'bar', 1, 40);
        const total = num(max);
        const filled = total <= 0 ? 0 : Math.max(0, Math.min(size, Math.round((num(value) / total) * size)));
        return '█'.repeat(filled) + '░'.repeat(size - filled);
    });
    def('randomString', 1, 2, (env, length, alphabet) => {
        const size = whole(length, 'randomString', 1, 100);
        const letters = alphabet === undefined ? 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' : [...str(alphabet, what('aText'))];
        if (!letters.length)
            fail('emptyText', { name: 'alphabet' });
        const bytes = (0, node_crypto_1.randomBytes)(size * 2);
        return Array.from({ length: size }, (_, index) => letters[((bytes[index * 2] << 8) | bytes[index * 2 + 1]) % letters.length]).join('');
    });
    def('uuid', 0, 0, () => (0, node_crypto_1.randomUUID)());
    def('sha256', 1, 1, (env, value) => (0, node_crypto_1.createHash)('sha256').update(text(value)).digest('hex'));
    def('base64Encode', 1, 1, (env, value) => { const out = Buffer.from(text(value), 'utf8').toString('base64'); if (out.length > MAX_TEXT)
        fail('textTooLong'); return out; });
    def('base64Decode', 1, 1, (env, value) => {
        const raw = text(value).trim();
        if (raw.length > MAX_TEXT || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(raw))
            fail('notBase64');
        return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    });
    // ── Numbers ──────────────────────────────────────────────────────────────
    def('avg', 1, null, (env, ...values) => { const all = numbers(values.length === 1 && Array.isArray(values[0]) ? values[0] : values); return all.length ? all.reduce((sum, value) => sum + value, 0) / all.length : 0; });
    def('median', 1, null, (env, ...values) => {
        const all = numbers(values.length === 1 && Array.isArray(values[0]) ? values[0] : values).sort((a, b) => a - b);
        if (!all.length)
            return 0;
        const middle = Math.floor(all.length / 2);
        return all.length % 2 ? all[middle] : (all[middle - 1] + all[middle]) / 2;
    });
    // What part is of total, in percent, with some decimals (0 when it is not said): `percent 1 3 1` is 33.3.
    def('percent', 2, 3, (env, part, total, decimals) => {
        const places = decimals === undefined ? 0 : whole(decimals, 'percent', 0, 6);
        if (num(total) === 0)
            return 0;
        const scale = 10 ** places;
        return Math.round((num(part) / num(total)) * 100 * scale) / scale;
    });
    def('between', 3, 3, (env, value, low, high) => num(value) >= Math.min(num(low), num(high)) && num(value) <= Math.max(num(low), num(high)));
    def('sign', 1, 1, (env, value) => Math.sign(num(value)));
    def('trunc', 1, 1, (env, value) => Math.trunc(num(value)));
    def('lerp', 3, 3, (env, from, to, amount) => num(from) + (num(to) - num(from)) * Math.max(0, Math.min(1, num(amount))));
    // ── Lists ────────────────────────────────────────────────────────────────
    def('chunk', 2, 2, (env, items, size) => {
        const all = list(items);
        const each = whole(size, 'chunk', 1, MAX_LIST);
        const out = [];
        for (let i = 0; i < all.length; i += each)
            out.push(all.slice(i, i + each));
        return out;
    });
    def('flatten', 1, 1, (env, items) => list(items).flatMap((item) => (Array.isArray(item) ? item : [item])).slice(0, MAX_LIST));
    // The `key` of each map of a list: `pluck .Mentions "ID"`.
    def('pluck', 2, 2, (env, items, key) => {
        const name = str(key, what('aText'));
        if (FORBIDDEN_KEYS.has(name))
            return [];
        return list(items).map((item) => (item && typeof item === 'object' && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, name) ? item[name] : null));
    });
    def('take', 2, 2, (env, items, count) => list(items).slice(0, Math.max(0, Math.trunc(num(count)))));
    def('drop', 2, 2, (env, items, count) => list(items).slice(Math.max(0, Math.trunc(num(count)))));
    def('without', 2, null, (env, items, ...values) => list(items).filter((item) => !values.some((value) => equals(item, value))));
    def('zip', 2, 2, (env, a, b) => { const left = list(a); const right = list(b); return Array.from({ length: Math.min(left.length, right.length, MAX_LIST) }, (_, index) => [left[index], right[index]]); });
    // The numbers from `from` to `to` (both included), 1 apart or `step` apart, at most 2000.
    def('upTo', 2, 3, (env, from, to, step) => {
        const first = Math.trunc(num(from));
        const last = Math.trunc(num(to));
        const by = step === undefined ? 1 : Math.trunc(num(step));
        if (by === 0)
            fail('range', { name: 'upTo step', min: 1, max: MAX_LIST });
        const out = [];
        for (let value = first; by > 0 ? value <= last : value >= last; value += by) {
            out.push(value);
            if (out.length > MAX_LIST)
                fail('listTooLong');
        }
        return out;
    });
    def('countOf', 2, 2, (env, items, value) => list(items).filter((item) => equals(item, value)).length);
    def('minOf', 1, 1, (env, items) => { const all = numbers(list(items)); return all.length ? Math.min(...all) : null; });
    def('maxOf', 1, 1, (env, items) => { const all = numbers(list(items)); return all.length ? Math.max(...all) : null; });
    // ── Choosing ─────────────────────────────────────────────────────────────
    // The first value that is not nil, not "" and not an empty list: `coalesce .Args.0 "nobody"`.
    def('coalesce', 1, null, (env, ...values) => {
        for (const value of values)
            if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length))
                return value;
        return null;
    });
    def('ternary', 3, 3, (env, condition, yes, no) => (isTruthy(condition) ? yes : no));
    // ── Dates (the time is in seconds, and the offset in hours from UTC) ─────
    def('startOfDay', 1, 2, (env, seconds, zone) => {
        const base = Math.trunc(num(seconds));
        const found = zoneOf(env, zone);
        if ('hours' in found) {
            const moved = base + Math.round(found.hours * 3600);
            return moved - (((moved % DAY) + DAY) % DAY) - Math.round(found.hours * 3600);
        }
        const local = new Date(base * 1000 + zoneOffsetMs(found.name, base * 1000));
        return Math.floor(zonedTimeToUtc(found.name, local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0) / 1000);
    });
    def('daysBetween', 2, 2, (env, from, to) => Math.floor((Math.trunc(num(to)) - Math.trunc(num(from))) / DAY));
    def('isWeekend', 1, 2, (env, seconds, zone) => { const day = new Date(shifted(env, seconds, zone) * 1000).getUTCDay(); return day === 0 || day === 6; });
    def('addDays', 2, 2, (env, seconds, days) => Math.trunc(num(seconds)) + Math.trunc(num(days)) * DAY);
}

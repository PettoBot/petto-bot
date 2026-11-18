"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.load = load;
exports.forget = forget;
exports.countHit = countHit;
exports.addLog = addLog;
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');
const DEFAULTS = { enabled: true, ignore_staff: true, log_channel_id: null };
const TABLES = ['mod_rule_settings', 'mod_lists', 'mod_rulesets', 'mod_rules'];
const cache = createExpiringCache(15_000, { invalidateOn: TABLES });
const arr = (value) => (Array.isArray(value) ? value : []);
/** Everything a message needs: the settings, the rulesets with their rules (only what is on) and the lists. A server with no rules costs one cached read. */
function load(guildId) {
    return cache.get(String(guildId), async () => {
        const pool = getPrimaryPool();
        const [settings, sets, rules, lists] = await Promise.all([
            pool.query('select enabled, ignore_staff, log_channel_id from mod_rule_settings where guild_id = $1', [guildId]),
            pool.query('select id, name, conditions from mod_rulesets where guild_id = $1 and enabled order by position, id', [guildId]),
            pool.query('select id, ruleset_id, name, trigger_mode, triggers, conditions, effects, threshold_count, threshold_minutes, stop from mod_rules where guild_id = $1 and enabled order by position, id', [guildId]),
            pool.query('select id, kind, items from mod_lists where guild_id = $1', [guildId]),
        ]);
        const words = new Map();
        const domains = new Map();
        for (const row of lists.rows)
            (row.kind === 'domains' ? domains : words).set(Number(row.id), arr(row.items));
        const rulesets = sets.rows.map((row) => ({ id: Number(row.id), name: String(row.name), conditions: arr(row.conditions), rules: [] }));
        const byId = new Map(rulesets.map((set) => [set.id, set]));
        for (const row of rules.rows) {
            byId.get(Number(row.ruleset_id))?.rules.push({
                id: Number(row.id), name: String(row.name), trigger_mode: String(row.trigger_mode), triggers: arr(row.triggers), conditions: arr(row.conditions), effects: arr(row.effects),
                threshold_count: Number(row.threshold_count) || 1, threshold_minutes: Number(row.threshold_minutes) || 10, stop: row.stop !== false,
            });
        }
        const first = settings.rows[0];
        return { settings: first ? { enabled: first.enabled !== false, ignore_staff: first.ignore_staff !== false, log_channel_id: first.log_channel_id ?? null } : { ...DEFAULTS }, rulesets: rulesets.filter((set) => set.rules.length), lists: { words, domains } };
    });
}
function forget(guildId) { cache.delete(String(guildId)); }
/** Counts a hit without waiting for it: a missed count is not worth slowing a message down. */
function countHit(guildId, ruleId) {
    getPrimaryPool().query('update mod_rules set hits = hits + 1 where guild_id = $1 and id = $2', [guildId, ruleId]).then(() => undefined, () => undefined);
}
const KEPT_LOGS = 500;
let written = 0;
/** What a rule did: the rule, the member, the channel, what matched and the effects. Never the text of the message. Only the last 500 are kept for each server. */
async function addLog(guildId, entry) {
    const pool = getPrimaryPool();
    await pool.query('insert into mod_rule_logs (guild_id, rule_id, rule_name, user_id, channel_id, trigger, effects) values ($1, $2, $3, $4, $5, $6, $7)', [guildId, entry.ruleId, entry.ruleName.slice(0, 60), entry.userId, entry.channelId, entry.trigger.slice(0, 120), entry.effects]);
    written += 1;
    if (written % 25 === 0) {
        await pool.query('delete from mod_rule_logs where guild_id = $1 and id not in (select id from mod_rule_logs where guild_id = $1 order by id desc limit $2)', [guildId, KEPT_LOGS]).catch(() => undefined);
    }
}

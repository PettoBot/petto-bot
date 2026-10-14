const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');
const { buildPatterns, toRegExp } = require('../utils/automodTemplates');

const MAX_RULES = 40;
const cache = createExpiringCache(15_000, { name: 'automod-rules', invalidateOn: ['automod_rules'] });

async function listRules(guildId) {
  const { data, error } = await database.from('automod_rules').select('*').eq('guild_id', guildId).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The enabled rules with their expressions already compiled, for the message hot path. */
async function listCompiled(guildId) {
  return cache.get(guildId, async () => {
    const rows = (await listRules(guildId)).filter((row) => row.enabled);
    return rows.map((row) => ({ ...row, regexes: buildPatterns(row.template, row.options).map(toRegExp).filter(Boolean) })).filter((row) => row.regexes.length);
  });
}

async function createRule(guildId, row) {
  const current = await listRules(guildId);
  if (current.length >= MAX_RULES) {
    const err = new Error(`A server can have ${MAX_RULES} filters. Remove one first.`);
    err.userFacing = true;
    throw err;
  }
  const { data, error } = await database.from('automod_rules').insert({ guild_id: guildId, ...row }).select('*').single();
  if (error) throw error;
  cache.delete(guildId);
  return data;
}

async function updateRule(guildId, id, patch) {
  const { data, error } = await database.from('automod_rules').update(patch).eq('guild_id', guildId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  cache.delete(guildId);
  return data;
}

async function deleteRule(guildId, id) {
  const { data, error } = await database.from('automod_rules').delete().eq('guild_id', guildId).eq('id', id).select('id');
  if (error) throw error;
  cache.delete(guildId);
  return (data ?? []).length > 0;
}

/** Counts a hit without waiting for it: a missed count is not worth slowing a message down. */
function countHit(guildId, rule) {
  database.from('automod_rules').update({ hits: (rule.hits ?? 0) + 1 }).eq('guild_id', guildId).eq('id', rule.id).then(() => {}, () => {});
}

module.exports = { MAX_RULES, listRules, listCompiled, createRule, updateRule, deleteRule, countHit };

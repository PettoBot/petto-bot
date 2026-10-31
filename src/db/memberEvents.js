const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// Every join asks whether the messages of the server wait for the member, so the settings are kept for a few seconds. Saving them here
// forgets them at once; a change made from the dashboard arrives on petto:invalidate (with Redis), or is seen within the 15 seconds.
const configCache = createExpiringCache(15_000, { name: 'member-events-config', invalidateOn: ['member_events_config'] });

async function getConfig(guildId) {
  const { data, error } = await database.from('member_events_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

/** The settings, from memory when they are recent. */
function getConfigCached(guildId) {
  return configCache.get(String(guildId), () => getConfig(guildId), { staleIfError: true });
}

const WELCOME_WAIT = Object.freeze(['off', 'rules', 'rules_onboarding']);

/** When the welcome of a channel is sent: `off` (at the join, the default), `rules` (after the member accepts the rules) or `rules_onboarding` (and finishes the onboarding). */
function welcomeWait(config) {
  return WELCOME_WAIT.includes(config?.welcome_wait) ? config.welcome_wait : 'off';
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database
    .from('member_events_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  configCache.delete(String(guildId));
  return data;
}

module.exports = { WELCOME_WAIT, getConfig, getConfigCached, welcomeWait, upsertConfig };

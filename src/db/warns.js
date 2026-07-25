const supabase = require('./supabase');
const { createCase } = require('./modActions');

/**
 * Records a warn. Every warn is both a numbered mod_actions case (so it
 * shows up in general history/logs) and a row in `warns` (so it can be
 * listed or revoked independently, e.g. a future /warnings or /delwarn).
 */
async function addWarn({ guildId, userId, moderatorId, reason = null }) {
  const modCase = await createCase({ guildId, userId, moderatorId, type: 'warn', reason });

  const { data, error } = await supabase
    .from('warns')
    .insert({
      guild_id: guildId,
      case_number: modCase.case_number,
      user_id: userId,
      moderator_id: moderatorId,
      reason,
    })
    .select('*')
    .single();

  if (error) throw error;

  const { count, error: countError } = await supabase
    .from('warns')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('active', true);

  if (countError) throw countError;

  return { warn: data, modCase, warnCount: count };
}

async function getActiveWarns(guildId, userId) {
  const { data, error } = await supabase
    .from('warns')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

module.exports = { addWarn, getActiveWarns };

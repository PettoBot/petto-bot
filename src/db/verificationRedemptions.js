const supabase = require('./supabase');

async function isRedeemed(jti) {
  const { data, error } = await supabase.from('verification_redemptions').select('jti').eq('jti', jti).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function markRedeemed({ jti, guildId, userId }) {
  const { error } = await supabase.from('verification_redemptions').insert({ jti, guild_id: guildId, user_id: userId });
  if (error) throw error;
}

/** Whether this user has ever successfully redeemed a verification link in this guild before (used to skip re-gating on rejoin). */
async function hasEverVerified(guildId, userId) {
  const { data, error } = await supabase.from('verification_redemptions').select('jti').eq('guild_id', guildId).eq('user_id', userId).limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

module.exports = { isRedeemed, markRedeemed, hasEverVerified };

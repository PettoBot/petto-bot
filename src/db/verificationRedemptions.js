const supabase = require('./supabase');

async function isRedeemed(jti) {
  const { data, error } = await supabase.from('verification_redemptions').select('jti').eq('jti', jti).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Atomically claims a verification token. The unique jti primary key makes this
 * safe when a member submits the same link twice at the same time.
 */
async function claimRedemption({ jti, guildId, userId }) {
  const { error } = await supabase.from('verification_redemptions').insert({ jti, guild_id: guildId, user_id: userId });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

/** Releases a claim when applying Discord roles failed, allowing a retry. */
async function releaseRedemption(jti) {
  const { error } = await supabase.from('verification_redemptions').delete().eq('jti', jti);
  if (error) throw error;
}

/** Whether this user has ever successfully redeemed a verification link in this guild before (used to skip re-gating on rejoin). */
async function hasEverVerified(guildId, userId) {
  const { data, error } = await supabase.from('verification_redemptions').select('jti').eq('guild_id', guildId).eq('user_id', userId).limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

module.exports = { isRedeemed, claimRedemption, releaseRedemption, hasEverVerified };

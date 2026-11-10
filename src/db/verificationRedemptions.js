const database = require('./database');

async function isRedeemed(jti) {
  const { data, error } = await database.from('verification_redemptions').select('jti').eq('jti', jti).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Atomically claims a verification token. The unique jti primary key makes this
 * safe when a member submits the same link twice at the same time.
 */
async function claimRedemption({ jti, guildId, userId }) {
  const { error } = await database.from('verification_redemptions').insert({ jti, guild_id: guildId, user_id: userId });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

/** Releases a claim when applying Discord roles failed, allowing a retry. */
async function releaseRedemption(jti) {
  const { error } = await database.from('verification_redemptions').delete().eq('jti', jti);
  if (error) throw error;
}

/** Whether this user has ever successfully redeemed a verification link in this guild before (the "you are already verified" answer of the letters). Not used to skip the gate when they join again. */
async function hasEverVerified(guildId, userId) {
  const { data, error } = await database.from('verification_redemptions').select('jti').eq('guild_id', guildId).eq('user_id', userId).limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** When this user last passed the verification in this guild (a Date), or null. It is what says "verified in this stay" (utils/verifyState.js). */
async function lastVerifiedAt(guildId, userId) {
  const { data, error } = await database.from('verification_redemptions').select('redeemed_at').eq('guild_id', guildId).eq('user_id', userId).order('redeemed_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.redeemed_at ? new Date(data.redeemed_at) : null;
}

/** Forgets that this user verified in this guild: the staff asked for a new check (`/verify send`). */
async function forgetVerification(guildId, userId) {
  const { error } = await database.from('verification_redemptions').delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

module.exports = { isRedeemed, claimRedemption, releaseRedemption, hasEverVerified, lastVerifiedAt, forgetVerification };

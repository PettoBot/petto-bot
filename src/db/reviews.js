const database = require('./database');

const DEFAULTS = { reviews_enabled: true, review_channel_id: null };

async function getConfig(guildId) {
  const { data, error } = await database.from('profile_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...(data ?? {}) };
}

async function upsertConfig(guildId, changes) {
  const { data, error } = await database.from('profile_config').upsert({ guild_id: String(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

/** Saves a review, or changes the one this reviewer already gave to this member. */
async function saveReview({ guildId, targetId, reviewerId, stars, comment }) {
  const { data, error } = await database
    .from('member_reviews')
    .upsert({ guild_id: String(guildId), target_id: String(targetId), reviewer_id: String(reviewerId), stars, comment, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,target_id,reviewer_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getReview(guildId, targetId, reviewerId) {
  const { data, error } = await database.from('member_reviews').select('*').eq('guild_id', String(guildId)).eq('target_id', String(targetId)).eq('reviewer_id', String(reviewerId)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function removeReview(guildId, targetId, reviewerId) {
  const { data, error } = await database.from('member_reviews').delete().eq('guild_id', String(guildId)).eq('target_id', String(targetId)).eq('reviewer_id', String(reviewerId)).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** The reviews of a member, newest first. */
async function listFor(guildId, targetId, limit = 500) {
  const { data, error } = await database.from('member_reviews').select('stars,comment,reviewer_id,updated_at').eq('guild_id', String(guildId)).eq('target_id', String(targetId)).order('updated_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

module.exports = { DEFAULTS, getConfig, upsertConfig, saveReview, getReview, removeReview, listFor };

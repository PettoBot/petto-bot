const supabase = require('./supabase');

async function createPoll({ guildId, channelId, messageId, creatorId, question, options, multi = false, endsAt = null }) {
  const { data, error } = await supabase
    .from('polls')
    .insert({ guild_id: guildId, channel_id: channelId, message_id: messageId, creator_id: creatorId, question, options, multi, ends_at: endsAt })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getPollByMessage(messageId) {
  const { data, error } = await supabase.from('polls').select('*').eq('message_id', messageId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getPoll(pollId) {
  const { data, error } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
  if (error) throw error;
  return data;
}

async function closePoll(pollId) {
  const { error } = await supabase.from('polls').update({ closed: true }).eq('id', pollId);
  if (error) throw error;
}

/** Sets (replaces) a user's vote for a poll — `choices` is an array of option indexes. */
async function castVote(pollId, userId, choices) {
  const { error } = await supabase.from('poll_votes').upsert({ poll_id: pollId, user_id: userId, choices, voted_at: new Date().toISOString() }, { onConflict: 'poll_id,user_id' });
  if (error) throw error;
}

async function getVote(pollId, userId) {
  const { data, error } = await supabase.from('poll_votes').select('*').eq('poll_id', pollId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getResults(pollId, optionCount) {
  const { data, error } = await supabase.from('poll_votes').select('choices').eq('poll_id', pollId);
  if (error) throw error;

  const counts = new Array(optionCount).fill(0);
  for (const row of data) {
    for (const choice of row.choices) {
      if (choice >= 0 && choice < optionCount) counts[choice] += 1;
    }
  }
  return { counts, voters: data.length };
}

module.exports = { createPoll, getPollByMessage, getPoll, closePoll, castVote, getVote, getResults };

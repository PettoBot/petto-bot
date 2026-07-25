const supabase = require('./supabase');

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

async function getTemplate(guildId, name) {
  const { data, error } = await supabase
    .from('embed_templates')
    .select('*')
    .eq('guild_id', guildId)
    .eq('name', normalizeName(name))
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Creates or fully replaces a template's `data` blob. */
async function upsertTemplate(guildId, name, data) {
  const { data: row, error } = await supabase
    .from('embed_templates')
    .upsert({ guild_id: guildId, name: normalizeName(name), data, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();

  if (error) throw error;
  return row;
}

async function deleteTemplate(guildId, name) {
  const { data, error } = await supabase.from('embed_templates').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('name');
  if (error) throw error;
  return data.length > 0;
}

async function listTemplates(guildId) {
  const { data, error } = await supabase.from('embed_templates').select('name, data').eq('guild_id', guildId).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

module.exports = { normalizeName, getTemplate, upsertTemplate, deleteTemplate, listTemplates };

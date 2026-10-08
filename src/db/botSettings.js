const database = require('./database');

async function getSetting(key) {
  const { data, error } = await database.from('bot_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function setSetting(key, value) {
  const { error } = await database.from('bot_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

module.exports = { getSetting, setSetting };

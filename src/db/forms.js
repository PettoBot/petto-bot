// Forms (applications): the forms of a server, what members sent, and the panels that open the forms. The rules of what a form may
// hold are in utils/forms.js; this file only reads and writes.
const database = require('./database');

const gid = (guildId) => String(guildId);
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function listForms(guildId) {
  const { data, error } = await database.from('forms').select('*').eq('guild_id', gid(guildId)).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** A form by its number (`12`) or its name (`staff`); null when the server has none like it. */
async function getForm(guildId, ref) {
  const text = String(ref ?? '').trim().toLowerCase();
  if (!text) return null;
  let query = database.from('forms').select('*').eq('guild_id', gid(guildId));
  if (/^\d{1,15}$/.test(text)) query = query.eq('id', Number(text));
  else if (NAME.test(text)) query = query.eq('name', text);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function countForms(guildId) {
  const { count, error } = await database.from('forms').select('id', { count: 'exact', head: true }).eq('guild_id', gid(guildId));
  if (error) throw error;
  return count ?? 0;
}

async function createForm(guildId, row) {
  const { data, error } = await database.from('forms').insert({ ...row, guild_id: gid(guildId) }).select('*').single();
  if (error) throw error;
  return data;
}

async function updateForm(guildId, id, changes) {
  const { data, error } = await database.from('forms').update({ ...changes, updated_at: new Date().toISOString() }).eq('guild_id', gid(guildId)).eq('id', Number(id)).select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function deleteForm(guildId, id) {
  const { error } = await database.from('forms').delete().eq('guild_id', gid(guildId)).eq('id', Number(id));
  if (error) throw error;
}

/** Stores what a member sent with the next number of the server. A second try covers two forms sent at the same moment. */
async function createSubmission(row) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: last, error: lastError } = await database.from('form_submissions').select('number').eq('guild_id', gid(row.guild_id)).order('number', { ascending: false }).limit(1);
    if (lastError) throw lastError;
    const number = (last?.[0]?.number ?? 0) + 1;
    const { data, error } = await database.from('form_submissions').insert({ ...row, guild_id: gid(row.guild_id), number }).select('*').single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not number the submission.'); // i18n-ignore: internal error
}

async function getSubmission(guildId, number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return null;
  const { data, error } = await database.from('form_submissions').select('*').eq('guild_id', gid(guildId)).eq('number', n).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function updateSubmission(guildId, number, changes) {
  const { data, error } = await database.from('form_submissions').update(changes).eq('guild_id', gid(guildId)).eq('number', Number(number)).select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Answers a submission that is still pending; null when someone answered it first. */
async function resolveSubmission(guildId, number, changes) {
  const { data, error } = await database.from('form_submissions').update(changes).eq('guild_id', gid(guildId)).eq('number', Number(number)).eq('status', 'pending').select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The submissions of a server, newest first, narrowed by form, state or member. */
async function listSubmissions(guildId, { formId = null, status = null, userId = null, limit = 25 } = {}) {
  let query = database.from('form_submissions').select('*').eq('guild_id', gid(guildId));
  if (formId) query = query.eq('form_id', Number(formId));
  if (status) query = query.eq('status', status);
  if (userId) query = query.eq('user_id', String(userId));
  const { data, error } = await query.order('number', { ascending: false }).limit(Math.min(200, Math.max(1, limit)));
  if (error) throw error;
  return data ?? [];
}

/** What a member already sent to a form: how many are waiting, how many in all (cancelled ones do not count) and their last denial. */
async function memberStats(guildId, formId, userId) {
  const { data, error } = await database.from('form_submissions').select('status,created_at,reviewed_at').eq('guild_id', gid(guildId)).eq('form_id', Number(formId)).eq('user_id', String(userId)).order('number', { ascending: false }).limit(500);
  if (error) throw error;
  const rows = data ?? [];
  const denied = rows.find((row) => row.status === 'denied');
  return {
    pending: rows.filter((row) => row.status === 'pending').length,
    total: rows.filter((row) => row.status !== 'cancelled').length,
    lastDeniedAt: denied ? (denied.reviewed_at ?? denied.created_at) : null,
  };
}

/** How many submissions a form got (cancelled ones do not count), for its limit of submissions. */
async function countFormSubmissions(guildId, formId) {
  const { count, error } = await database.from('form_submissions').select('id', { count: 'exact', head: true }).eq('guild_id', gid(guildId)).eq('form_id', Number(formId)).neq('status', 'cancelled');
  if (error) throw error;
  return count ?? 0;
}

async function createPanel(guildId, row) {
  const { data, error } = await database.from('form_panels').insert({ ...row, guild_id: gid(guildId) }).select('*').single();
  if (error) throw error;
  return data;
}

async function updatePanel(guildId, id, changes) {
  const { data, error } = await database.from('form_panels').update(changes).eq('guild_id', gid(guildId)).eq('id', Number(id)).select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function getPanel(guildId, id) {
  const { data, error } = await database.from('form_panels').select('*').eq('guild_id', gid(guildId)).eq('id', Number(id)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function listPanels(guildId) {
  const { data, error } = await database.from('form_panels').select('*').eq('guild_id', gid(guildId)).order('id', { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

async function deletePanel(guildId, id) {
  const { error } = await database.from('form_panels').delete().eq('guild_id', gid(guildId)).eq('id', Number(id));
  if (error) throw error;
}

module.exports = {
  NAME, listForms, getForm, countForms, createForm, updateForm, deleteForm,
  createSubmission, getSubmission, updateSubmission, resolveSubmission, listSubmissions, memberStats, countFormSubmissions,
  createPanel, updatePanel, getPanel, listPanels, deletePanel,
};

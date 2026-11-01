// Forms (applications): the forms of a server, what members sent, and the panels that open the forms. The rules of what a form may
// hold are in utils/forms.js; this file only reads and writes.
const database = require('./database');
const { getPrimaryPool } = require('./postgres');
const { newPublicId, PUBLIC_ID } = require('../utils/forms');

const gid = (guildId) => String(guildId);
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function listForms(guildId) {
  const { data, error } = await database.from('forms').select('*').eq('guild_id', gid(guildId)).order('number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * A form as a person names it: its number inside the server (`2`, the one `!form list` shows) or its name (`staff`); null when the
 * server has none like it. A name made only of digits is still found by name when the server has no form with that number. This never
 * looks at the internal `id`: use `getFormById` for the id that buttons and menus carry.
 */
async function getForm(guildId, ref) {
  const text = String(ref ?? '').trim().toLowerCase().replace(/^#/, '');
  if (!text) return null;
  if (/^\d{1,9}$/.test(text)) {
    const { data, error } = await database.from('forms').select('*').eq('guild_id', gid(guildId)).eq('number', Number(text)).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return NAME.test(text) ? getFormByName(guildId, text) : null;
}

/** A form of the server by its name. */
async function getFormByName(guildId, name) {
  const text = String(name ?? '').trim().toLowerCase();
  if (!NAME.test(text)) return null;
  const { data, error } = await database.from('forms').select('*').eq('guild_id', gid(guildId)).eq('name', text).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * A form by its internal id, the one that button, menu and modal ids carry and that submissions keep as `form_id`. Never shown to a
 * person and never typed by one. It only finds forms of this server: an id of another server's form is simply not found.
 */
async function getFormById(guildId, id) {
  const text = String(id ?? '').trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  const { data, error } = await database.from('forms').select('*').eq('guild_id', gid(guildId)).eq('id', Number(text)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * A form by the random id of its web address, for the website's page of a form (petto.sbs/form/<public id>), which does not know the
 * server. Numbers are never looked up here, so the forms cannot be walked through one by one.
 */
async function getFormByPublicId(publicId) {
  if (!PUBLIC_ID.test(String(publicId ?? ''))) return null;
  const { data, error } = await database.from('forms').select('*').eq('public_id', String(publicId)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function countForms(guildId) {
  const { count, error } = await database.from('forms').select('id', { count: 'exact', head: true }).eq('guild_id', gid(guildId));
  if (error) throw error;
  return count ?? 0;
}

/**
 * Makes a form. The database gives it the next number of the server (see forms_assign_number in schema.sql): a `number` in `row` is
 * ignored. A second try covers the rare clash of two forms made at the same moment; a name that is taken still fails at once.
 */
async function createForm(guildId, row) {
  const { number: _ignored, ...fields } = row;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await database.from('forms').insert({ ...fields, public_id: fields.public_id ?? newPublicId(), guild_id: gid(guildId) }).select('*').single();
    if (!error) return data;
    if (error.code !== '23505' || !String(error.constraint ?? error.message ?? '').includes('number')) throw error;
  }
  throw new Error('Could not number the form.'); // i18n-ignore: internal error
}

async function updateForm(guildId, id, changes) {
  const { number: _kept, ...allowed } = changes; // the number of a form never changes
  const { data, error } = await database.from('forms').update({ ...allowed, updated_at: new Date().toISOString() }).eq('guild_id', gid(guildId)).eq('id', Number(id)).select('*').maybeSingle();
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

/** How many submissions a server keeps, and how many of them wait for a review (for the cap of each plan). */
async function countStored(guildId) {
  const client = database;
  const [all, waiting] = await Promise.all([
    client.from('form_submissions').select('id', { count: 'exact', head: true }).eq('guild_id', gid(guildId)),
    client.from('form_submissions').select('id', { count: 'exact', head: true }).eq('guild_id', gid(guildId)).eq('status', 'pending'),
  ]);
  if (all.error) throw all.error;
  if (waiting.error) throw waiting.error;
  return { total: all.count ?? 0, pending: waiting.count ?? 0 };
}

/** A new web address for a form: the old link stops working. */
async function renewPublicId(guildId, id) {
  return updateForm(guildId, id, { public_id: newPublicId() });
}

/** Deletes the oldest reviewed submissions of a server until it keeps `keep` at most. Pending ones are never deleted. */
async function trimOldest(guildId, keep) {
  const { rowCount } = await getPrimaryPool().query(
    `delete from form_submissions where id in (
       select id from form_submissions where guild_id = $1 and status <> 'pending'
       order by coalesce(reviewed_at, created_at) asc
       limit greatest(0, (select count(*) from form_submissions where guild_id = $1) - $2)
     )`,
    [gid(guildId), Math.max(0, Number(keep) || 0)],
  );
  return rowCount ?? 0;
}

/**
 * Removes the answers of reviewed submissions older than `days`: the row stays small (form, member, state, reviewer, dates and the
 * link to its card). With `guildId` only that server; without it every server except `except` (the ones with their own setting).
 */
async function compactBefore(days, { guildId = null, except = [] } = {}) {
  const params = [Math.max(1, Number(days) || 30)];
  let where = `status <> 'pending' and not compacted and coalesce(reviewed_at, created_at) < now() - ($1::int * interval '1 day')`; // i18n-ignore: SQL
  if (guildId) { params.push(gid(guildId)); where += ' and guild_id = $2'; } // i18n-ignore: SQL
  else if (except.length) { params.push(except.map(String)); where += ' and not (guild_id = any($2::text[]))'; } // i18n-ignore: SQL
  const { rowCount } = await getPrimaryPool().query(`update form_submissions set answers = '[]'::jsonb, avatar_url = null, reason = null, role_changes = '{}'::jsonb, compacted = true where ${where}`, params);
  return rowCount ?? 0;
}

const RETENTION_DEFAULT = 30;

async function getFormConfig(guildId) {
  const { data, error } = await database.from('form_config').select('*').eq('guild_id', gid(guildId)).maybeSingle();
  if (error) throw error;
  return { retention_days: RETENTION_DEFAULT, ...(data ?? {}) };
}

async function setFormConfig(guildId, changes) {
  const { data, error } = await database.from('form_config').upsert({ guild_id: gid(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return data;
}

/** The servers that chose their own retention (the others use the default). */
async function listRetentionConfigs() {
  const { data, error } = await database.from('form_config').select('guild_id,retention_days').neq('retention_days', RETENTION_DEFAULT);
  if (error) throw error;
  return data ?? [];
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
  getFormByPublicId, renewPublicId,
  NAME, RETENTION_DEFAULT, countStored, trimOldest, compactBefore, getFormConfig, setFormConfig, listRetentionConfigs, listForms, getForm, getFormByName, getFormById, countForms, createForm, updateForm, deleteForm,
  createSubmission, getSubmission, updateSubmission, resolveSubmission, listSubmissions, memberStats, countFormSubmissions,
  createPanel, updatePanel, getPanel, listPanels, deletePanel,
};

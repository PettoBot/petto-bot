// The files members attach to the answers of an appeal form, kept as bytes in PostgreSQL (like the pictures of an appeal page).
// A file is uploaded while the form is being filled, so it has no submission until the form is sent; the ones never sent are removed.
const { getPrimaryPool } = require('./postgres');

const META = 'id, guild_id, user_id, form_id, question_id, submission_id, name, mime, size, created_at';

async function createFile({ guildId, userId, formId, questionId, name, mime, bytes }) {
  const { rows } = await getPrimaryPool().query(
    `insert into appeal_files (guild_id, user_id, form_id, question_id, name, mime, size, bytes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${META}`,
    [String(guildId), String(userId), formId, String(questionId), name, mime, bytes.length, bytes],
  );
  return rows[0];
}

/** The files a person uploaded for a question and has not sent yet. */
async function listLoose(guildId, userId, formId, questionId = null) {
  const { rows } = await getPrimaryPool().query(
    `select ${META} from appeal_files where guild_id = $1 and user_id = $2 and form_id = $3 and submission_id is null and ($4::text is null or question_id = $4) order by created_at`,
    [String(guildId), String(userId), formId, questionId],
  );
  return rows;
}

async function countLoose(guildId, userId) {
  const { rows } = await getPrimaryPool().query('select count(*)::int as n from appeal_files where guild_id = $1 and user_id = $2 and submission_id is null', [String(guildId), String(userId)]);
  return rows[0]?.n ?? 0;
}

async function getMeta(guildId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await getPrimaryPool().query(`select ${META} from appeal_files where guild_id = $1 and id = $2`, [String(guildId), id]);
  return rows[0] ?? null;
}

async function getFile(guildId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await getPrimaryPool().query(`select ${META}, bytes from appeal_files where guild_id = $1 and id = $2`, [String(guildId), id]);
  return rows[0] ?? null;
}

/** Ties the files of a sent form to its submission. Only files of that person and server that were not sent before are tied. */
async function attach(guildId, userId, ids, submissionId) {
  if (!ids.length) return 0;
  const { rowCount } = await getPrimaryPool().query(
    'update appeal_files set submission_id = $4 where guild_id = $1 and user_id = $2 and submission_id is null and id = any($3::uuid[])',
    [String(guildId), String(userId), ids, submissionId],
  );
  return rowCount;
}

async function listForSubmission(submissionId, { withBytes = false } = {}) {
  const { rows } = await getPrimaryPool().query(`select ${META}${withBytes ? ', bytes' : ''} from appeal_files where submission_id = $1 order by created_at`, [submissionId]);
  return rows;
}

async function removeLoose(guildId, userId, id) {
  const { rowCount } = await getPrimaryPool().query('delete from appeal_files where guild_id = $1 and user_id = $2 and id = $3 and submission_id is null', [String(guildId), String(userId), id]);
  return rowCount > 0;
}

/** Removes the files that were uploaded and never sent with a form. */
async function deleteLooseBefore(beforeIso) {
  const { rowCount } = await getPrimaryPool().query('delete from appeal_files where submission_id is null and created_at < $1', [beforeIso]);
  return rowCount;
}

module.exports = { createFile, listLoose, countLoose, getMeta, getFile, attach, listForSubmission, removeLoose, deleteLooseBefore };

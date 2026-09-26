// Historical compatibility filename.
// Petto no longer connects to Supabase; every runtime query uses Discloud PostgreSQL.
const { createPostgresClient, getPrimaryPool } = require('./postgres');

module.exports = createPostgresClient(getPrimaryPool());

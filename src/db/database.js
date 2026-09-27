// Shared query client for Petto's Discloud PostgreSQL database.
const { createPostgresClient, getPrimaryPool } = require('./postgres');

module.exports = createPostgresClient(getPrimaryPool());

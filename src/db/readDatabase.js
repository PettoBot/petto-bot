// i18n-ignore-file: SQL and database plumbing, no text anybody reads
// The query client (`from(...).select()...`) for the heavy reads: the read-only copy when PETTO_READ_DATABASE_URL is set, the main database otherwise.
// Made on first use. Only plain reads belong here (the statistics): a write sent to a read-only copy would fail.
const { createPostgresClient, getReadPool } = require('./postgres');

let client;
module.exports = {
  from(...args) {
    client ??= createPostgresClient(getReadPool());
    return client.from(...args);
  },
};

// The Vault connection uses TLS only when it is asked for: PETTO_VAULT_DATABASE_SSL decides when it is set, otherwise sslmode=require|verify-ca|verify-full in the address.
// An address without it connects in plain (the Discloud database answers "The server does not support SSL connections" to TLS).
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost/db';
const assert = require('node:assert/strict');
const { sslFor } = require('../src/db/vault');

const url = (text) => new URL(text);
assert.equal(sslFor(url('postgres://u:p@host:5432/db'), null), false, 'no sslmode, nothing set: plain');
assert.equal(sslFor(url('postgres://u:p@host:5432/db?sslmode=require'), null), true);
assert.equal(sslFor(url('postgres://u:p@host:5432/db?sslmode=verify-full'), null), true);
assert.equal(sslFor(url('postgres://u:p@host:5432/db?sslmode=disable'), null), false);
assert.equal(sslFor(url('postgres://u:p@host:5432/db?sslmode=require'), false), false, 'the setting wins over the address');
assert.equal(sslFor(url('postgres://u:p@host:5432/db'), true), true, 'the setting wins over the address');
console.log('Vault SSL checks passed (plain unless asked, the setting wins).');

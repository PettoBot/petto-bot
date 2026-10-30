// The private route the dashboard calls after it saves a server's language (POST /internal/guild-language): only with the
// dashboard key, only the three language codes, and the bot uses the new language at once instead of after its 5 minute cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to

// The saved language of each server, as the dashboard left it in the database; the reads are counted.
const saved = new Map();
let reads = 0;
const guildsPath = require.resolve('../src/db/guilds');
require.cache[guildsPath] = {
  id: guildsPath, filename: guildsPath, loaded: true,
  exports: {
    findGuildLanguage: async (id) => { reads += 1; return saved.get(id) ?? null; },
    listGuildLanguages: async () => { reads += 1; return [...saved].filter(([, language]) => language !== 'en').map(([guild_id, language]) => ({ guild_id, language })); },
  },
};

const { guildLanguage, loadGuildLanguages } = require('../src/i18n');
const { registerGuildLanguageRoute } = require('../src/web/languageRoutes');

const KEY = 'secret-key';
const GUILD = '111111111111111111';

function call(port, body, headers = { 'x-petto-dashboard-key': KEY }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/internal/guild-language', headers: { ...headers, 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || 'null') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

(async () => {
  const app = express();
  app.use(express.json());
  let limited = 0;
  const changes = [];
  registerGuildLanguageRoute(app, { isAuthorized: (req) => req.get('x-petto-dashboard-key') === KEY, limiter: (req, res, next) => { limited += 1; next(); }, onChange: async (guildId, language) => { changes.push([guildId, language]); throw new Error('a panel could not be edited'); } });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    // The bot loaded the languages when it was ready: this server is English.
    saved.set(GUILD, 'en');
    await loadGuildLanguages();
    assert.equal(await guildLanguage(GUILD), 'en');
    assert.equal(reads, 1, 'one query for every server');

    // Without the key, or with a wrong one, nothing changes.
    let res = await call(port, { guildId: GUILD, language: 'es' }, {});
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { ok: false, error: 'unauthorized' });
    res = await call(port, { guildId: GUILD, language: 'es' }, { 'x-petto-dashboard-key': 'wrong' });
    assert.equal(res.status, 401);

    // Only a server id and exactly en, es or pt-BR.
    for (const body of [{ language: 'es' }, { guildId: 'abc', language: 'es' }, { guildId: 123456789012345678, language: 'es' }]) {
      res = await call(port, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error, 'invalid_guild');
    }
    for (const language of ['pt', 'ES', 'pt-br', 'spanish', 'fr', '', null, 1, undefined]) {
      res = await call(port, { guildId: GUILD, language });
      assert.equal(res.status, 400, `language ${JSON.stringify(language)}`);
      assert.equal(res.json.error, 'invalid_language');
      assert.deepEqual(res.json.languages, ['en', 'es', 'pt-BR']);
    }
    assert.equal(await guildLanguage(GUILD), 'en', 'a refused request leaves the language as it was');
    assert.deepEqual(changes, [], 'and redraws nothing');

    // The dashboard saved Spanish and tells the bot: the next command is already in Spanish, without reading the database.
    saved.set(GUILD, 'es');
    res = await call(port, { guildId: GUILD, language: 'es' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, guildId: GUILD, language: 'es' });
    const readsBefore = reads;
    assert.equal(await guildLanguage(GUILD), 'es', 'used at once, not after 5 minutes');
    assert.equal(reads, readsBefore, 'from the cache the route refreshed');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(changes, [[GUILD, 'es']], 'then the panels of that server are redrawn (a failure there does not touch the answer)');

    res = await call(port, { guildId: GUILD, language: 'pt-BR' });
    assert.equal(res.status, 200);
    assert.equal(await guildLanguage(GUILD), 'pt-BR');
    res = await call(port, { guildId: '222222222222222222', language: 'en' });
    assert.equal(res.status, 200, 'a server the bot has not cached yet is fine too');
    assert.equal(await guildLanguage('222222222222222222'), 'en');

    assert.ok(limited > 0, 'the rate limiter runs before the route');
  } finally {
    server.close();
  }

  // The bot's web server mounts it behind the same dashboard key check as the other dashboard routes.
  const source = fs.readFileSync(path.join(__dirname, '../src/web/server.js'), 'utf8');
  const registration = source.slice(source.indexOf('registerGuildLanguageRoute(app'), source.indexOf('registerGuildLanguageRoute(app') + 900);
  assert.match(registration, /isAuthorized: dashboardAuthorized,/);
  assert.match(registration, /onChange: async \(guildId, language\) =>/);
  assert.match(registration, /language_source: 'manual'/, 'a language saved by the dashboard is marked as chosen');
  assert.match(registration, /refreshGuildPanels\(client\.guilds\.cache\.get\(guildId\), language\)/);
  assert.ok(source.indexOf('registerGuildLanguageRoute(app') > source.indexOf('if (dashboardEnabled) {'), 'only when the dashboard API is on');
  console.log('Checked the dashboard language route.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Checks the languages of the bot's web server through real HTTP requests: the verification page follows the browser
// (Accept-Language), then the server's language; the API messages follow `?lang=`, then the `x-petto-language` header; the codes
// the website matches on stay the same; English stays exactly as it was. The database and Discord are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
stub('src/db/verificationConfig.js', { getConfig: async () => ({ method: 'letters' }) });
stub('src/db/verificationRedemptions.js', { isRedeemed: async () => false, claimRedemption: async () => true, releaseRedemption: async () => {} });

require('../src/db/guilds').ensureGuild = async () => ({}); // read by the routes when they load
const config = require('../src/config');
Object.assign(config, { verifyBaseUrl: 'https://verify.example', verifyTokenSecret: 'check-web-i18n-secret', dashboardApiSecret: 'dash-key', topggWebhookSecret: '', webPort: 0, turnstileSiteKey: 'site' });
const { createToken } = require('../src/utils/verifyToken');
const { setCachedGuildLanguage } = require('../src/i18n');
const { startServer } = require('../src/web/server');

const GUILD = '111111111111111111';
const OTHER = '222222222222222222';
const USER = '333333333333333333';
const member = { id: USER, displayName: 'Mod', user: { id: USER, username: 'mod' }, permissions: { has: (flag) => flag === PermissionFlagsBits.ManageGuild } };
const makeGuild = (id, name) => ({ id, name, iconURL: () => null, members: { fetch: async () => member, cache: new Map() }, channels: { cache: new Map() } });
const guilds = new Map([[GUILD, makeGuild(GUILD, 'Petto HQ')], [OTHER, makeGuild(OTHER, 'Casa')]]);
const client = { guilds: { cache: guilds, fetch: async (id) => guilds.get(id) ?? Promise.reject(new Error('Unknown Guild')) }, users: { fetch: async () => null } };

function call(port, method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* a page */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const app = startServer(client);
  assert.ok(app, 'the web server starts with the verification and dashboard settings');
  const server = http.createServer(app).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const token = createToken({ userId: USER, guildId: GUILD });
  const otherToken = createToken({ userId: USER, guildId: OTHER });

  // The verification page speaks the visitor's language, from the Accept-Language of the browser.
  const page = (headers, which = token) => call(port, 'GET', `/verify/${which}`, { headers });
  let res = await page({ 'accept-language': 'es-MX,es;q=0.9,en;q=0.8' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('<html lang="es">') && res.text.includes('Escribe las letras que ves') && res.text.includes('Verificando para <b>Petto HQ</b>'), 'Spanish page');
  assert.ok(res.text.includes('aria-label="Progreso de la verificación"') && !res.text.includes('Type the letters you see'), 'nothing left in English');
  res = await page({ 'accept-language': 'pt-BR,pt;q=0.9' });
  assert.ok(res.text.includes('<html lang="pt-BR">') && res.text.includes('Digite as letras que você vê') && res.text.includes('"button":"Verificar com o Petto"'), 'Portuguese page, script texts included');
  res = await page({ 'accept-language': 'en-US,en;q=0.9' });
  assert.ok(res.text.includes('<html lang="en">') && res.text.includes('Type the letters you see') && res.text.includes('aria-label="Petto home"'), 'English page');
  // A browser in a language Petto does not speak gets the language of the server.
  setCachedGuildLanguage(OTHER, 'pt-BR');
  res = await page({ 'accept-language': 'fr-FR,fr;q=0.9' }, otherToken);
  assert.ok(res.text.includes('<html lang="pt-BR">') && res.text.includes('Verificando para <b>Casa</b>'), 'the server language when the browser has none of ours');
  res = await page({ 'accept-language': 'fr-FR,fr;q=0.9' });
  assert.ok(res.text.includes('<html lang="en">'), 'English for an English server');

  // The verification API: the text the page shows, in the language asked for; the code stays.
  res = await call(port, 'POST', '/api/verify?lang=es', { body: { token: 'nonsense' } });
  assert.deepEqual([res.status, res.json], [400, { ok: false, error: 'Este enlace de verificación no es válido o ya caducó. Vuelve a unirte al servidor para recibir uno nuevo.' }]);
  res = await call(port, 'POST', '/api/verify', { body: { token: 'nonsense' }, headers: { 'x-petto-language': 'pt-BR' } });
  assert.equal(res.json.error, 'Este link de verificação é inválido ou expirou. Entre no servidor de novo para receber um novo.');
  res = await call(port, 'POST', '/api/verify', { body: { token: 'nonsense' } });
  assert.equal(res.json.error, 'This verification link is invalid or has expired. Rejoin the server to get a new one.', 'English stays the same');
  res = await call(port, 'POST', '/api/verify', { body: { token, captchaTicket: 'nonsense', captchaAnswer: 'ABCDE' }, headers: { 'accept-language': 'es' } });
  assert.deepEqual(res.json, { ok: false, code: 'invalid', error: 'La imagen no es válida. Pide otra.' }, 'the code the page matches on is kept');
  res = await call(port, 'POST', '/api/verify', { body: { token, captchaTicket: 'nonsense', captchaAnswer: 'ABCDE' } });
  assert.deepEqual(res.json, { ok: false, code: 'invalid', error: 'The picture is not valid. Ask for a new one.' });

  // Dashboard messages: `?lang=` first, then the header, then English for an English server; `error` codes never change.
  const auth = { 'x-petto-dashboard-key': 'dash-key' };
  const answer = (query, headers = {}) => call(port, 'POST', `/api/dashboard/guild/${GUILD}/suggestions/answer?user_id=${USER}${query}`, { body: { id: 'bad', status: 'approved' }, headers: { ...auth, ...headers } });
  res = await answer('&lang=es', { 'x-petto-language': 'pt-BR' });
  assert.deepEqual([res.status, res.json], [400, { ok: false, message: 'Eso no es una sugerencia ni un estado.' }], '?lang= wins');
  res = await answer('', { 'x-petto-language': 'pt-BR' });
  assert.equal(res.json.message, 'Isso não é uma sugestão nem um status.');
  res = await answer('');
  assert.equal(res.json.message, 'That is not a suggestion or a status.');
  res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/giveaway/dance?user_id=${USER}&lang=es`, { body: {}, headers: auth });
  assert.deepEqual([res.status, res.json], [404, { ok: false, error: 'unknown_action', message: 'Esa acción no existe.' }]);
  res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/giveaway/start?user_id=${USER}`, { body: { prize: '' }, headers: { ...auth, 'x-petto-language': 'pt-BR' } });
  assert.deepEqual(res.json, { ok: false, error: 'invalid_prize', message: 'Escreva o prêmio.' });
  res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/lockdown?user_id=${USER}&lang=pt-BR`, { body: { op: 'start' }, headers: auth });
  assert.deepEqual([res.status, res.json], [403, { ok: false, message: 'Só administradores podem iniciar ou encerrar um bloqueio.' }]);
  res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/identity?user_id=${USER}`, { body: { action: 'notify_set', notify_source: 'x' }, headers: { ...auth, 'x-petto-language': 'es' } });
  assert.deepEqual([res.status, res.json], [400, { ok: false, error: 'invalid_action', message: 'Elige vanity o guildtag.' }]);
  res = await call(port, 'POST', `/api/dashboard/guild/${GUILD}/giveaway/dance?user_id=${USER}&lang=es`, { body: {} });
  assert.deepEqual([res.status, res.json], [401, { ok: false, error: 'unauthorized' }], 'machine answers are not translated');

  // Plain pages: the home page, a page that does not exist, a transcript link that is not valid.
  res = await call(port, 'GET', '/', { headers: { 'accept-language': 'pt-BR' } });
  assert.ok(res.text.includes('<html lang="pt-BR">') && res.text.includes('Online · presente em 2 servidores'), 'Portuguese home page');
  res = await call(port, 'GET', '/');
  assert.ok(res.text.includes('<html lang="en">') && res.text.includes('Online · serving 2 servers'), 'English home page');
  assert.deepEqual([(await call(port, 'GET', '/nothing?lang=es')).text, (await call(port, 'GET', '/nothing')).text], ['No se encontró.', 'Not found.']);
  res = await call(port, 'GET', `/transcript/${GUILD}/1/nonsense`, { headers: { 'x-petto-language': 'pt-BR' } });
  assert.deepEqual([res.status, res.text], [403, 'O link da transcrição é inválido ou foi alterado.']);
  res = await call(port, 'GET', '/api/nothing?lang=es');
  assert.deepEqual(res.json, { ok: false, error: 'not_found' }, 'the API keeps its codes');

  server.close();
  console.log('Checked the languages of the web server: pages, API messages and codes.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

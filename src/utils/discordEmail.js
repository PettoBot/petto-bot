// i18n-ignore-file: the OAuth2 calls of Discord for "Use my Discord email"; the texts people read are in the catalogs (web.verifyApi.email.*)
// The email of the verification can be the one Discord already has: the member logs in with Discord (scopes `identify` and `email`), Petto reads the
// id and the email once, checks it is the same account the link was made for and that Discord verified the email, and revokes the access at once.
// Nothing of it is kept. Needs DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and the redirect `<VERIFY_BASE_URL>/api/verify/discord/callback` added in the
// OAuth2 page of the application in the Discord developer portal.
const config = require('../config');
const { baseUrl, linkProblem } = require('./verifyLink');

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const API = 'https://discord.com/api/v10';

const CALLBACK_PATH = '/api/verify/discord/callback';

/** Whether the page can offer it: the application ids are set and the base address of the links is a public one. */
const configured = () => Boolean(config.clientId && config.discordClientSecret && !linkProblem());

const redirectUri = () => `${baseUrl()}${CALLBACK_PATH}`;

/** Where the member goes to log in. `token` (the verification link's token) comes back as `state`: it is signed, and the callback checks the account against it. */
function authorizeUrl(token) {
  const query = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: redirectUri(), scope: 'identify email', state: token });
  return `${AUTHORIZE}?${query}`;
}

/**
 * Trades the code for the account: `{ ok: true, id, email, verified }` or `{ ok: false, reason: 'rejected' | 'unreachable' }`. The access is revoked
 * before returning. `fetcher` (tests) replaces the network.
 */
async function identityFromCode(code, { fetcher = globalThis.fetch } = {}) {
  const form = (values) => new URLSearchParams(values).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  let access = null;
  try {
    const tokenResponse = await fetcher(`${API}/oauth2/token`, {
      method: 'POST', headers,
      body: form({ grant_type: 'authorization_code', code: String(code ?? ''), redirect_uri: redirectUri(), client_id: config.clientId, client_secret: config.discordClientSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) return { ok: false, reason: 'rejected' };
    access = (await tokenResponse.json().catch(() => null))?.access_token ?? null;
    if (!access) return { ok: false, reason: 'rejected' };
    const me = await fetcher(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10_000) });
    if (!me.ok) return { ok: false, reason: 'rejected' };
    const user = await me.json().catch(() => null);
    if (!user?.id) return { ok: false, reason: 'rejected' };
    return { ok: true, id: String(user.id), email: typeof user.email === 'string' ? user.email : null, verified: user.verified === true };
  } catch (error) {
    return { ok: false, reason: 'unreachable', detail: error.message };
  } finally {
    if (access) {
      fetcher(`${API}/oauth2/token/revoke`, { method: 'POST', headers, body: form({ token: access, token_type_hint: 'access_token', client_id: config.clientId, client_secret: config.discordClientSecret }), signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
  }
}

module.exports = { configured, redirectUri, authorizeUrl, identityFromCode, CALLBACK_PATH };

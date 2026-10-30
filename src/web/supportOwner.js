// SUPPORT MODE, the bot's side. The Petto owner can fix the errors of a server he does not manage from the dashboard, but only through
// the routes listed here. The site has its own list (src/utils/supportEdit.ts of petto-web); this one is the bot's, so the bot does not
// trust only the site: a route that is not listed is refused for the owner exactly as for anybody who does not manage the server.
//
// DEFAULT IS DENY. Never add: create or delete of feeds or counters, Premium, Customize, moderation, backups, verification, forms, tickets,
// access, permissions or anything that gives roles, removes data or changes who can do what. The request still needs the dashboard key.
// Each entry has its method: a GET listed here does not open the POST of the same path, and the other way round.
const config = require('../config');
const logger = require('../utils/logger');

const BASE = '/api/dashboard/guild/:guildId';
const CARDS = '/api/dashboard/cards/:guildId';
// `name` is what the log says; `path` is the whole route (`:guildId`, `:timerId` and `:assetId` are ids); `method` is the one that is allowed.
const SUPPORT_ROUTES = [
  // Feeds: change one, send a test notice, and the reads of the form (resolve an account, search, preview). Not create or delete.
  ...['update', 'test', 'resolve', 'search', 'preview'].map((action) => ({ name: `feeds/${action}`, path: `${BASE}/feeds/${action}` })),
  // Counters: refresh, reorder and the announcement (`announce` also sends the test one). Not preview, create, setup or delete.
  ...['refresh', 'reorder', 'announce'].map((action) => ({ name: `counters/${action}`, path: `${BASE}/counters/${action}` })),
  { name: 'timers/run', path: `${BASE}/timers/:timerId/run` },
  { name: 'confessions/panel', path: `${BASE}/confessions/panel` },
  { name: 'resync', path: `${BASE}/resync` },
].map((route) => ({ method: 'POST', ...route })).concat([
  // Image cards and Embeds pages: only the two reads (the list, and the picture of an uploaded asset). Not save, delete, upload, preview or normalize.
  { method: 'GET', name: 'cards/list', path: CARDS },
  { method: 'GET', name: 'cards/asset', path: `${CARDS}/assets/:assetId` },
]).map((route) => ({
  method: route.method,
  name: route.name,
  // Express matches routes without case and with a final slash, so this does too.
  regexp: new RegExp(`^${route.path.replace(':guildId', '(\\d{15,25})').replace(':timerId', '\\d{1,18}').replace(':assetId', '\\d{1,18}')}/?$`, 'i'),
}));

/**
 * The listed route a request goes to, as `{ name, guildId }`, or null when it is not one the owner may use.
 * @param {string} method
 * @param {string} pathname
 */
function supportRouteOf(method, pathname) {
  const verb = String(method).toUpperCase();
  for (const route of SUPPORT_ROUTES) {
    if (route.method !== verb) continue;
    const match = route.regexp.exec(String(pathname));
    if (match) return { name: route.name, guildId: match[1] };
  }
  return null;
}

/**
 * Whether this request may pass the "manages the server" check as the Petto owner: the person is the owner, the route is on the list and
 * its server is the one being opened. Call it only after the dashboard key was checked. Leaves one line in the log (no body).
 * @param {{ method: string, path: string, params?: Record<string, string> }} req
 * @param {string} userId
 * @param {string} guildId
 */
function supportOwnerAllows(req, userId, guildId) {
  if (!config.ownerId || String(userId) !== String(config.ownerId)) return false;
  const route = supportRouteOf(req.method, req.path);
  if (!route || route.guildId !== String(guildId) || String(req.params?.guildId) !== String(guildId)) return false;
  logger.info(`support: owner ${userId} ${route.name} on guild ${guildId}`);
  return true;
}

module.exports = { SUPPORT_ROUTES, supportRouteOf, supportOwnerAllows };

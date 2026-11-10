// i18n-ignore-file: the list of the exit nodes of the Tor network, for the Tor check of the verification (utils/verifyChecks.js)
// The Tor Project publishes the addresses its exit nodes connect from (https://check.torproject.org/torbulkexitlist). The list is read when the bot starts and every hour
// (jobs/verifyChecksJob.js) and kept in memory: a visitor on it is going through Tor. Until it has been read once nothing is on it, so nobody is stopped by a list that is not there.
const { normalizeIp } = require('./verifyChecks');
const logger = require('./logger');

const URL_LIST = 'https://check.torproject.org/torbulkexitlist';
const MIN_ADDRESSES = 100; // the real list has over a thousand: an answer with fewer is a mistake, and the list that was read before is kept

let exits = new Set();
let loadedAt = 0;

/** The addresses of a text with one on each line (comments start with #). */
function parseList(text) {
  const found = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const ip = normalizeIp(line.replace(/#.*/, ''));
    if (ip) found.add(ip);
  }
  return found;
}

/** Reads the list again. `fetcher` (tests) replaces the network. Returns how many addresses it has, or 0 when it kept the old list. */
async function refresh({ fetcher = globalThis.fetch } = {}) {
  try {
    const response = await fetcher(URL_LIST, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Petto verification (https://petto.sbs)' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const found = parseList(await response.text());
    if (found.size < MIN_ADDRESSES) throw new Error(`only ${found.size} addresses`);
    exits = found;
    loadedAt = Date.now();
    return found.size;
  } catch (error) {
    logger.warn(`The list of Tor exit nodes could not be read: ${error.message}. ${loadedAt ? 'The one read before is kept.' : 'The Tor check lets everybody through until it is read.'}`);
    return 0;
  }
}

/** Whether an address is an exit node of Tor. */
const isExit = (ip) => exits.has(normalizeIp(ip));
const size = () => exits.size;
/** For the checks. */
function setForTest(list) { exits = new Set(list); loadedAt = Date.now(); }

module.exports = { refresh, isExit, size, parseList, setForTest, URL_LIST };

// i18n-ignore-file: database plumbing between two instances of the bot (operator logs only).
// Which databases of the primary a worker can reach through the SQL bridge: the main one, and the Vault, the code database and the second one when the primary has them apart.
// Asked once at start (`load`); without a bridge (an instance with its own connection) nothing here is on and every database is used directly.
const config = require('../config');
const logger = require('../utils/logger');

const have = new Set();

/** True for an instance that has no direct connection to the main database and goes through the bridge. */
const active = () => !config.primaryDatabaseUrl && Boolean(config.dbBridgeUrl && config.dbBridgeSecret);

const RETRY_MS = 60_000;
let retry = null;
let warned = false;

/**
 * Asks the primary which databases it has. If it does not answer (it was restarting when this instance started, which happens after every deploy), the question is asked again every minute
 * until it does: before, the Vault, the code database and the second one stayed off until the next start of the instance ("backups are not configured"). The first failure is a warning, the
 * next ones go to the plain log.
 */
async function load({ retryMs = RETRY_MS } = {}) {
  if (!active()) return [];
  try {
    const targets = await require('./postgres').getPrimaryPool().info();
    for (const target of targets) have.add(target);
    if (retry) { clearInterval(retry); retry = null; }
    logger.info(`SQL bridge: the primary has the databases ${targets.join(', ')}${warned ? ' (it answered after failing before)' : ''}.`);
    warned = false;
    return targets;
  } catch (error) {
    const text = `SQL bridge: could not ask the primary which databases it has (${error?.message ?? error}); the Vault and the other databases are off on this instance until it answers, and it is asked again every minute.`;
    if (warned) logger.info(text); else logger.warn(text);
    warned = true;
    if (!retry) {
      retry = setInterval(() => { load({ retryMs }).catch(() => {}); }, retryMs);
      retry.unref?.();
    }
    return [];
  }
}

/** Whether a database other than the main one (`vault`, `code`, `data2`) is reached through the bridge. */
const has = (target) => active() && have.has(target);

/** The pool of one of those databases, through the bridge. */
const poolFor = (target) => require('./postgres').makeBridgePool(target);

module.exports = { active, load, has, poolFor };

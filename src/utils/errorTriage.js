// i18n-ignore-file: triage of errors for the Petto team (English only, never shown to members).
// Decides what an error is worth: something expected that Petto lives with (a button pressed after its 3 seconds, a channel that was already
// deleted, a rate limit, a network hiccup, a Redis timeout) goes to the general log as a warning and never pings anybody; anything else is a
// PRIORITY error, for the team to look at. The table is data: add a row to teach it a new code or a new kind of message.
const crypto = require('node:crypto');
const path = require('node:path');

// What Petto does about each kind. `none`: nothing to do, it is expected. `already-done`: the thing is gone, so the job is done.
// `late-answer`: the answer cannot go through the dead interaction. `retry`: try once more. `ask-server`: the server has to fix its setup.
// `investigate`: a person has to look.
const FIX = Object.freeze({ NONE: 'none', ALREADY_DONE: 'already-done', LATE_ANSWER: 'late-answer', RETRY: 'retry', ASK_SERVER: 'ask-server', INVESTIGATE: 'investigate' });

/** Discord API codes that are expected, or that are known and still need a look (`priority: true`). */
const API_CODES = Object.freeze({
  10062: { kind: 'unknown-interaction', fix: FIX.LATE_ANSWER, explain: 'Unknown interaction: someone pressed a button and Petto took more than 3 seconds to answer, or pressed it twice. Not a bug by itself.' },
  40060: { kind: 'already-acknowledged', fix: FIX.NONE, explain: 'Interaction already acknowledged: two handlers (or two copies of Petto) answered the same press. Harmless.' },
  10003: { kind: 'unknown-channel', fix: FIX.ALREADY_DONE, explain: 'Unknown Channel: the channel was deleted before Petto finished (for example a ticket deleted by hand or twice). The work is already done.' },
  10008: { kind: 'unknown-message', fix: FIX.ALREADY_DONE, explain: 'Unknown Message: the message was already deleted. Nothing left to do.' },
  10007: { kind: 'unknown-member', fix: FIX.NONE, explain: 'Unknown Member: that person left the server before Petto finished.' },
  10013: { kind: 'unknown-user', fix: FIX.NONE, explain: 'Unknown User: that account no longer exists.' },
  10004: { kind: 'unknown-guild', fix: FIX.NONE, explain: 'Unknown Guild: Petto was removed from that server (or it is unavailable) while working on it.' },
  10015: { kind: 'unknown-webhook', fix: FIX.NONE, explain: 'Unknown Webhook: the server deleted the webhook Petto was using. Petto makes a new one when it needs it.' },
  50001: { kind: 'missing-access', fix: FIX.ASK_SERVER, server: true, explain: 'Missing Access: Petto cannot see that channel or server. The server has to give Petto access; it is their setup.' },
  50013: { kind: 'missing-permissions', fix: FIX.ASK_SERVER, server: true, explain: 'Missing Permissions: the server did not give Petto a permission it needs there. It is their setup, not a bug.' },
  160002: { kind: 'missing-history', fix: FIX.ASK_SERVER, server: true, explain: 'Cannot reply without Read Message History: the server has to give Petto that permission in the channel.' },
  50007: { kind: 'dm-closed', fix: FIX.NONE, explain: 'Cannot send messages to this user: the person has direct messages closed. Normal.' },
  40333: { kind: 'cannot-send', fix: FIX.NONE, explain: 'Cannot send messages in this channel: the channel does not allow it right now.' },
  // The limits of Discord for a server (maximum roles, webhooks, emojis, channels, pins...): the server is full, not Petto.
  30001: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum guilds).' },
  30003: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum pins in the channel).' },
  30005: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum roles in the server).' },
  30007: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum webhooks in the channel).' },
  30008: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum emojis in the server).' },
  30010: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum reactions on the message).' },
  30013: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum channels in the server or the category).' },
  30015: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum attachments in a message).' },
  30016: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum invites).' },
  30018: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum animated emojis).' },
  30019: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum server members).' },
  30030: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum server categories).' },
  30031: { kind: 'discord-limit', fix: FIX.ASK_SERVER, explain: 'A Discord limit was reached (maximum guild widgets or similar).' },
  // Known codes that DO mean Petto sent something wrong: a person has to look.
  50035: { kind: 'invalid-form-body', priority: true, explain: 'Invalid Form Body: Petto sent Discord something it refuses (a text too long, an empty field, a broken component). This is a bug in a message Petto builds.' },
  50006: { kind: 'empty-message', priority: true, explain: 'Cannot send an empty message: Petto tried to send a message with nothing in it. This is a bug.' },
  50109: { kind: 'invalid-json', priority: true, explain: 'Invalid JSON: Petto sent a request Discord cannot read. This is a bug.' },
  40005: { kind: 'payload-too-large', priority: true, explain: 'Request entity too large: Petto tried to upload something bigger than Discord accepts (a transcript or a file).' },
  50024: { kind: 'wrong-channel-type', priority: true, explain: 'Cannot execute this action on this channel type: Petto used an action the channel does not support.' },
  50080: { kind: 'bad-component', priority: true, explain: 'Invalid component: a button or menu Petto built is not valid.' },
});

/** Node and network error codes: the connection failed or was too slow; trying again is normal. */
const NETWORK_CODES = Object.freeze(['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ABORT_ERR']);
/** PostgreSQL codes of a lost or overloaded connection (class 08, shutdowns 57P0x, too many connections 53300, a cancelled slow query 57014). */
const DATABASE_CONNECTION_CODES = Object.freeze(['57P01', '57P02', '57P03', '53300', '57014', '08000', '08001', '08003', '08004', '08006', '08007', '08P01']);

/** Messages with no useful code: matched in order, the first one wins. */
const MESSAGE_PATTERNS = Object.freeze([
  { kind: 'rate-limit', fix: FIX.RETRY, test: /rate ?limit|too many requests|you are being rate limited/i, explain: 'Rate limit: Discord asked Petto to slow down. Petto waits and tries again by itself.' },
  { kind: 'redis-timeout', fix: FIX.RETRY, test: /\bredis\b[^]*?(timed? ?out|timeout|connection|ECONN|ETIMEDOUT)|(timed? ?out|timeout)[^]*?\bredis\b/i, explain: 'Redis timeout or connection problem: Petto skips Redis for a few seconds and uses the database. Nothing to do.' },
  { kind: 'database-connection', fix: FIX.RETRY, test: /connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|terminating connection|server closed the connection|too many clients|the database system is (starting up|shutting down)|Connection (?:ended|refused)/i, explain: 'The database connection dropped or was busy for a moment. Petto reconnects by itself.' },
  { kind: 'timeout', fix: FIX.RETRY, test: /took more than \d+(?:\.\d+)? ?(?:s|sec|seconds?|ms)|timed? ?out|timeout|deadline exceeded|\bout after \d+/i, explain: 'Something took too long (a slow answer from Discord, the network or the host). Usually passes by itself.' },
  { kind: 'network', fix: FIX.RETRY, test: /fetch failed|socket hang up|network (?:error|request failed)|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|aborted|getaddrinfo|other side closed/i, explain: 'A network error between Petto and Discord (or another service). Usually passes by itself.' },
  { kind: 'discord-outage', fix: FIX.RETRY, test: /service unavailable|bad gateway|gateway time-?out|internal server error|overloaded|Discord is having|No available server|upstream connect error/i, explain: 'Discord had a problem on its side (a 5xx answer). Nothing for Petto to fix.' },
  { kind: 'missing-permission-text', fix: FIX.ASK_SERVER, test: /\bMissing (?:Permissions|Access)\b|Cannot send messages to this user|Cannot reply without permission/i, explain: 'A permission the server has to give Petto is missing. It is their setup, not a bug.' },
]);

const JS_BUGS = new Set(['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError', 'URIError', 'AssertionError']);

const NAMED_CODES = Object.freeze({ interaction: 10062, channel: 10003, message: 10008, member: 10007, user: 10013, guild: 10004, webhook: 10015 });

const EXPLAIN_UNKNOWN = 'Unknown: needs a look.';

const isObject = (value) => value !== null && typeof value === 'object';
const isErrorLike = (value) => value instanceof Error || (isObject(value) && typeof value.message === 'string');

/** The first error-like value among the arguments of a log call (or the value itself). */
function findError(args) {
  const list = Array.isArray(args) ? args : [args];
  return list.find(isErrorLike) ?? null;
}

// --------------------------------------------------------------------------------------------------------------------
// Secrets and mentions: nothing that goes to the team channel carries a token, a password or a way to ping people.
// --------------------------------------------------------------------------------------------------------------------

const SECRET_ENV_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE|DATABASE_URL|REDIS_URL|WEBHOOK|DSN|CREDENTIAL/i;

/** The values of the secrets in the environment (long enough to be real), so they are removed wherever they appear. */
function environmentSecrets(env = process.env) {
  const values = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_ENV_NAME.test(name) && typeof value === 'string' && value.length >= 8) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Removes tokens, passwords, bearer tokens, webhook and interaction links and the values of secret environment variables from a text. */
function redactSecrets(value, { env = process.env } = {}) {
  let text = String(value ?? '');
  for (const secret of environmentSecrets(env)) text = text.split(secret).join('[REDACTED]');
  return text
    // The user and password of any address: postgres://user:pass@host, redis://:pass@host, https://user:pass@host.
    .replace(/\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/@:]*:[^\s/@]*@/gi, '$1[REDACTED]@')
    .replace(/\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    // Webhooks and the callback of an interaction carry their secret in the path.
    .replace(/(\/webhooks\/\d{5,25}\/)[A-Za-z0-9._-]{8,}/gi, '$1[REDACTED]')
    .replace(/(\/interactions\/\d{5,25}\/)[A-Za-z0-9._-]{8,}/gi, '$1[REDACTED]')
    .replace(/(\/webhooks\/\d{5,25}\/)\[REDACTED\]\/[A-Za-z0-9._-]{8,}/gi, '$1[REDACTED]')
    .replace(/(\/interactions\/\d{5,25}\/)\[REDACTED\]\/[A-Za-z0-9._-]{8,}/gi, '$1[REDACTED]')
    // Headers and assignments: Authorization: Bearer x, token=x, password: x, api_key=x.
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer|bot|basic)\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(bearer|bot)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]')
    .replace(/\b((?:[a-z_]*(?:token|secret|password|passwd|api[_-]?key|private[_-]?key|authorization|cookie|session[_-]?id))\s*["']?\s*[:=]\s*["']?)[^\s,;"'&}]+/gi, '$1[REDACTED]')
    // A bot token (three parts), a JWT, and the usual key shapes of other services.
    .replace(/\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/\b(?:ghp|gho|ghs|ghu|github_pat|xox[abprs]|AIza)[-_A-Za-z0-9]{16,}\b/g, '[REDACTED_KEY]')
    // The query of a link can hold a signature or a key.
    .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]+/gi, '$1?[REDACTED]');
}

const ZERO_WIDTH = '​';

/**
 * Makes a text unable to notify anybody: @everyone and @here, user, role and channel mentions and the plain `@name` forms get a zero width
 * space inside them. Applied to every field of a card, so nobody can make Petto ping the team (or anyone) with the text of an error.
 */
function stripMentions(value) {
  return String(value ?? '')
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH}$1`)
    .replace(/<(@[!&]?|#|\/|a?:)/g, `<${ZERO_WIDTH}$1`)
    .replace(/@(?=[A-Za-z0-9_.])/g, `@${ZERO_WIDTH}`);
}

// --------------------------------------------------------------------------------------------------------------------
// Looking inside an error.
// --------------------------------------------------------------------------------------------------------------------

/** The numbers, ids and times of a message are replaced, so the same problem on two servers has the same text. */
function normalizeMessage(message) {
  return redactSecrets(message)
    .replace(/<(?:@[!&]?|#)\d+>/g, '<#>')
    .replace(/https?:\/\/\S+/gi, (url) => url.replace(/\d+/g, '#'))
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, '#')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** The first frames of a stack (`function (file:line:col)`), with the project folder cut off and secrets removed. */
function stackFrames(error, limit = 6) {
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const root = process.cwd();
  const frames = [];
  for (const line of stack.split('\n')) {
    const match = /^\s*at\s+(.*)$/.exec(line);
    if (!match) continue;
    let frame = match[1].trim();
    if (root && root !== '/') frame = frame.split(`${root}${path.sep}`).join('');
    frame = frame.replace(/file:\/\//g, '');
    frames.push(redactSecrets(frame).slice(0, 160));
  }
  return frames.slice(0, limit);
}

/** The frame that identifies where it happened: the first one of Petto's own code, else the first one. */
function firstFrame(error) {
  const frames = stackFrames(error, 40);
  const frame = frames.find((entry) => !/node:internal|node_modules/.test(entry)) ?? frames[0] ?? '';
  return frame.replace(/:\d+:\d+(?=\)?$)/, '');
}

function statusOf(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.httpStatus ?? error?.response?.status);
  return Number.isInteger(status) && status >= 100 && status < 600 ? status : null;
}

function codeOf(error) {
  const raw = error?.code ?? error?.rawError?.code;
  if (typeof raw === 'number') return raw;
  return raw ?? null;
}

const isDiscordApiError = (error) => /DiscordAPIError/.test(String(error?.name ?? error?.constructor?.name ?? '')) || (isObject(error?.rawError) && 'code' in error.rawError);

/** What the text of an error and its context says: the error message, the api message, and what the code wrote before it. */
function textOf(error, args = []) {
  const parts = [];
  for (const arg of Array.isArray(args) ? args : [args]) {
    if (typeof arg === 'string') parts.push(arg);
    else if (isErrorLike(arg) && arg !== error) parts.push(String(arg.message));
  }
  if (error) {
    parts.push(String(error.message ?? ''));
    if (error.rawError?.message && error.rawError.message !== error.message) parts.push(String(error.rawError.message));
  }
  return parts.join(' ').trim();
}

// --------------------------------------------------------------------------------------------------------------------
// classify
// --------------------------------------------------------------------------------------------------------------------

function makeResult({ kind, priority, fix, explain, error, text, code = null, status = null }) {
  return {
    priority,
    benign: !priority,
    kind,
    fix,
    explanation: explain,
    code,
    status,
    fingerprint: fingerprint({ kind, text, error }),
  };
}

/** Same kind + same normalized message + same first frame = the same problem, wherever it happens. Ten characters of a hash. */
function fingerprint({ kind, text, error }) {
  const message = normalizeMessage(text || error?.message || '');
  const frame = firstFrame(error);
  return crypto.createHash('sha1').update(`${kind}|${message}|${frame}`).digest('hex').slice(0, 10);
}

/**
 * What an error is. `error` is the error (or null); `context` can have `args` (everything the log call was given, to read its text), `text`,
 * `level`, `internal` (a failure of Petto's own channels, where a missing permission is not a server's setup) and `exhausted` (it already
 * failed again after a retry: a timeout that keeps happening is something to look at).
 * Returns { priority, benign, kind, fix, fingerprint, explanation, code, status }.
 */
function classify(error, context = {}) {
  const found = isErrorLike(error) ? error : findError(context.args ?? []);
  const text = context.text ?? textOf(found, context.args ?? (typeof error === 'string' ? [error] : []));
  const status = statusOf(found);
  const code = codeOf(found);
  const name = String(found?.name ?? found?.constructor?.name ?? '');
  const base = { error: found, text, code, status };
  const exhausted = Boolean(context.exhausted);

  // A bug in Petto's own code is never expected.
  if (JS_BUGS.has(name)) return makeResult({ ...base, kind: 'code-bug', priority: true, fix: FIX.INVESTIGATE, explain: `${name}: a bug in Petto's code. This needs a fix.` });

  const escalate = (result) => (exhausted && result.fix === FIX.RETRY
    ? makeResult({ ...base, kind: `${result.kind}-persisted`, priority: true, fix: FIX.INVESTIGATE, explain: `${result.explanation} It happened again after Petto tried a second time, so it needs a look.` })
    : result);

  // The name of a Discord error written in the text ("Unknown interaction"), when the code did not come along.
  const named = /\bUnknown (Interaction|Channel|Message|Member|User|Guild|Webhook)\b/i.exec(text);
  const knownCode = typeof code === 'number' && API_CODES[code] ? code : named ? NAMED_CODES[named[1].toLowerCase()] : null;

  // Discord's numeric codes (also on plain objects with a code, which is what the checks use).
  if (knownCode) {
    const row = API_CODES[knownCode];
    // A missing permission is the server's setup, except in Petto's own places (its channels), where it needs a look.
    const ownPlace = Boolean(row.server) && context.internal === true;
    const priority = Boolean(row.priority) || ownPlace;
    return makeResult({ ...base, code: knownCode, kind: row.kind, priority, fix: priority ? FIX.INVESTIGATE : row.fix, explain: ownPlace ? `${row.explain} This happened in a place of Petto itself, so it needs a look.` : row.explain });
  }

  // Rate limits and 5xx answers of Discord.
  if (status === 429 || /RateLimitError/.test(name)) return escalate(makeResult({ ...base, kind: 'rate-limit', priority: false, fix: FIX.RETRY, explain: MESSAGE_PATTERNS[0].explain }));
  if (status !== null && status >= 500) return escalate(makeResult({ ...base, kind: 'discord-outage', priority: false, fix: FIX.RETRY, explain: MESSAGE_PATTERNS.find((row) => row.kind === 'discord-outage').explain }));

  // Network and database connection codes.
  if (typeof code === 'string' && NETWORK_CODES.includes(code)) return escalate(makeResult({ ...base, kind: 'network', priority: false, fix: FIX.RETRY, explain: MESSAGE_PATTERNS.find((row) => row.kind === 'network').explain }));
  if (/^(TimeoutError|AbortError|ConnectTimeoutError|HeadersTimeoutError|BodyTimeoutError|SocketError)$/.test(name)) return escalate(makeResult({ ...base, kind: 'timeout', priority: false, fix: FIX.RETRY, explain: MESSAGE_PATTERNS.find((row) => row.kind === 'timeout').explain }));
  if (typeof code === 'string' && DATABASE_CONNECTION_CODES.includes(code)) return escalate(makeResult({ ...base, kind: 'database-connection', priority: false, fix: FIX.RETRY, explain: MESSAGE_PATTERNS.find((row) => row.kind === 'database-connection').explain }));

  // A database error that is not a lost connection: a bad query, a constraint, a missing column. A SQLSTATE is five characters.
  if (typeof code === 'string' && /^(?:[0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code)) {
    const syntax = code.startsWith('42');
    return makeResult({ ...base, kind: syntax ? 'database-syntax' : 'database-error', priority: true, fix: FIX.INVESTIGATE, explain: syntax ? `Database error ${code}: a query Petto sent is wrong (a missing table or column, or bad syntax). This is a bug or a migration that was not applied.` : `Database error ${code}: the database refused what Petto tried to save (a constraint or a value). Needs a look.` });
  }

  // An unknown number on an error of Discord's API: Petto does not know this one yet.
  if (isDiscordApiError(found) && typeof code === 'number') {
    return makeResult({ ...base, kind: 'unknown-api-code', priority: true, fix: FIX.INVESTIGATE, explain: `Discord API code ${code} that Petto does not know yet: ${EXPLAIN_UNKNOWN.toLowerCase()}` });
  }

  // The text, when there is no code.
  for (const row of MESSAGE_PATTERNS) {
    if (!row.test.test(text)) continue;
    const priority = row.kind === 'missing-permission-text' && context.internal === true;
    return escalate(makeResult({ ...base, kind: row.kind, priority, fix: priority ? FIX.INVESTIGATE : row.fix, explain: row.explain }));
  }

  if (!found && !text) return makeResult({ ...base, kind: 'unknown', priority: true, fix: FIX.INVESTIGATE, explain: EXPLAIN_UNKNOWN });
  return makeResult({ ...base, kind: found ? 'unexpected-error' : 'unexpected-message', priority: true, fix: FIX.INVESTIGATE, explain: EXPLAIN_UNKNOWN });
}

/** The short question for callers: can this error be answered with "it is already done" (the channel or the message is gone)? */
const isGone = (error) => [10003, 10008].includes(Number(error?.code));
/** The interaction is dead: expired (10062) or already answered (40060). */
const isExpired = (error) => [10062, 40060].includes(Number(error?.code));
/** Worth one more try: a timeout, a rate limit, a 5xx, a network error, a lost database connection. */
function isTransient(error) {
  if (!error) return false;
  const result = classify(error);
  return result.benign && result.fix === FIX.RETRY;
}
/** How long Discord asked to wait, in milliseconds (from `retry_after`, `retryAfter` or the `Retry-After` header), or null. */
function retryAfterMs(error) {
  const seconds = Number(error?.retry_after ?? error?.rawError?.retry_after ?? error?.data?.retry_after);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  const millis = Number(error?.retryAfter ?? error?.timeToReset);
  return Number.isFinite(millis) && millis > 0 ? Math.ceil(millis) : null;
}

module.exports = {
  FIX,
  API_CODES,
  NETWORK_CODES,
  DATABASE_CONNECTION_CODES,
  MESSAGE_PATTERNS,
  EXPLAIN_UNKNOWN,
  classify,
  fingerprint,
  normalizeMessage,
  redactSecrets,
  stripMentions,
  stackFrames,
  firstFrame,
  findError,
  textOf,
  isErrorLike,
  isGone,
  isExpired,
  isTransient,
  retryAfterMs,
};

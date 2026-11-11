// i18n-ignore-file: the detail goes to the Petto team (the dashboard in Support mode and the log), never to a server
// What went wrong with a feed, in a line for the team: the kind of error, the code or status, and what the service or Discord said. A server never sees this (it sees a
// plain reason), so a key, a token or an address with a secret in it must not stay: they are cut out before the line is kept.

const MAX = 400;

/** Takes keys, tokens and long random strings out of a text. */
function redact(text) {
  return String(text ?? '')
    .replace(/\b(Bearer|Bot|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [hidden]')
    .replace(/([?&](?:key|api_key|apikey|token|access_token|client_secret|secret|signature|sig)=)[^&\s"']+/gi, '$1[hidden]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[hidden]')
    .replace(/\b(?:AIza|sk-|ghp_|xox[abp]-)[A-Za-z0-9_-]{10,}/g, '[hidden]');
}

/** One line for an error: `DiscordAPIError[50035] (400): Invalid Form Body ...`, `notConfigured: youtube`, `TimeoutError: ...`. */
function describeError(error) {
  if (!error) return null;
  if (typeof error === 'string') return redact(error).slice(0, MAX) || null;
  const name = error.name && error.name !== 'Error' ? String(error.name) : '';
  const code = error.code ?? error.kind ?? error.cause?.code;
  const status = error.status ?? error.httpStatus ?? error.statusCode;
  const head = [name, code !== undefined && code !== null ? `[${code}]` : ''].join('');
  const where = status ? ` (${status})` : '';
  const message = redact(error.message ?? '').replace(/\s+/g, ' ').trim();
  const line = `${head}${where}${message ? `${head || where ? ': ' : ''}${message}` : ''}`.trim();
  return line.slice(0, MAX) || null;
}

/** How a failure to post is shown to the server, from what Discord answered (a word the dashboard turns into a plain reason). */
function sendKindOf(error) {
  const code = error?.code;
  if (code === 10003) return 'channelGone';
  if (code === 50001 || code === 50013) return 'permission';
  if (code === 50035 || code === 50006) return 'sendRejected'; // Invalid Form Body, Cannot send an empty message
  const status = Number(error?.status ?? error?.httpStatus ?? 0);
  const name = error?.name;
  if (status === 429 || status >= 500 || name === 'TimeoutError' || name === 'AbortError' || /timeout|ECONN|ENOTFOUND|EAI_AGAIN|under pressure|queue/i.test(`${error?.message ?? ''} ${error?.code ?? ''}`)) return 'sendBusy';
  return 'send';
}

module.exports = { describeError, sendKindOf, redact };

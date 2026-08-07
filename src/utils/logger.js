const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' };
let discordSink = null;

function log(level, ...args) {
  const stamp = new Date().toISOString();
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  method(`[${stamp}] [${LEVELS[level]}]`, ...args);
  if (discordSink) {
    Promise.resolve(discordSink(level, args, stamp)).catch(() => {});
  }
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  setDiscordSink: (sink) => { discordSink = typeof sink === 'function' ? sink : null; },
};

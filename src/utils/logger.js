const { AsyncLocalStorage } = require('node:async_hooks');

const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' };
const CONTEXT_KEYS = new Set(['guildId', 'serverId', 'channelId', 'userId', 'memberId', 'action', 'command', 'source']);
const contextStorage = new AsyncLocalStorage();
let discordSink = null;

function isContext(value) {
  return value && typeof value === 'object' && !(value instanceof Error) && Object.keys(value).some((key) => CONTEXT_KEYS.has(key));
}

function splitContext(args) {
  if (!isContext(args[0])) return { context: null, logArgs: args };
  return { context: args[0], logArgs: args.slice(1) };
}

function contextLabel(context) {
  if (!context) return null;
  const labels = [
    ['guild', context.guildId ?? context.serverId],
    ['channel', context.channelId],
    ['user', context.userId ?? context.memberId],
    ['action', context.action],
    ['command', context.command],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  return labels.length ? `[${labels.map(([key, value]) => `${key}=${value}`).join(' ')}]` : null;
}

function log(level, ...args) {
  const stamp = new Date().toISOString();
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  const { context: explicitContext, logArgs } = splitContext(args);
  const context = { ...(contextStorage.getStore() ?? {}), ...(explicitContext ?? {}) };
  const label = contextLabel(context);
  method(`[${stamp}] [${LEVELS[level]}]`, ...(label ? [label, ...logArgs] : logArgs));
  if (discordSink && level !== 'info') {
    Promise.resolve(discordSink(level, logArgs, stamp, context)).catch(() => {});
  }
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  setDiscordSink: (sink) => { discordSink = typeof sink === 'function' ? sink : null; },
  runWithContext: (context, callback) => contextStorage.run(context ?? {}, callback),
};

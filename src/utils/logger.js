const { AsyncLocalStorage } = require('node:async_hooks');

const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' };
const CONTEXT_KEYS = new Set(['guildId', 'serverId', 'channelId', 'userId', 'memberId', 'action', 'command', 'source']);
const contextStorage = new AsyncLocalStorage();
let discordSinks = [];

// The bot starts (database, commands, the Cloudflare tunnel) before it connects to Discord, and the log of Discord is only attached once it
// is connected: what is written before is only in the host console. The lines the team needs from that time (the Cloudflare tunnel, and
// every warning and error) are kept and said in the log when it connects. Nothing else is kept, so a normal start adds no noise.
const EARLY_KEEP = /cloudflare|cloudflared|tunnel/i;
const EARLY_LIMIT = 80;
let earlyLines = [];
let earlyOpen = true;

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
  if (earlyOpen && (level !== 'info' || EARLY_KEEP.test(logArgs.map((part) => (part instanceof Error ? part.message : String(part))).join(' ')))) {
    earlyLines.push({ level, logArgs, stamp, context });
    if (earlyLines.length > EARLY_LIMIT) earlyLines.shift();
  }
  for (const discordSink of discordSinks) {
    Promise.resolve(discordSink(level, logArgs, stamp, context)).catch(() => {});
  }
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  setDiscordSink: (sink) => { discordSinks = typeof sink === 'function' ? [sink] : []; },
  // `replayEarly` is for the general log of the team: it is told what was kept from before it existed (the other sinks, of errors, are
  // attached at the very start and got those lines live).
  addDiscordSink: (sink, { replayEarly = false } = {}) => {
    if (typeof sink !== 'function' || discordSinks.includes(sink)) return;
    discordSinks.push(sink);
    if (replayEarly && earlyOpen) {
      earlyOpen = false;
      const lines = earlyLines;
      earlyLines = [];
      for (const line of lines) Promise.resolve(sink(line.level, line.logArgs, line.stamp, line.context)).catch(() => {});
    }
  },
  runWithContext: (context, callback) => contextStorage.run(context ?? {}, callback),
};

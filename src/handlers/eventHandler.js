const { isPermissionError } = require('../utils/permissionErrors');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { peekGuildLanguage, languageFromLocale, runWithLanguage } = require('../i18n');
const guildBlacklist = require('../utils/guildBlacklist');
const perf = require('../utils/perf');
const loadGuard = require('../utils/loadGuard');

// The interactions of a blacklisted server that were already answered "not available": every listener of interactionCreate asks, only the first one answers.
const blockedAnswered = new WeakSet();

const EVENTS_DIR = path.join(__dirname, '..', 'events');

function eventContext(eventName, args) {
  const objects = args.filter((value) => value && typeof value === 'object');
  const guildId = objects.map((value) => value.guildId ?? value.guild?.id ?? value.channel?.guild?.id).find(Boolean);
  const channelId = objects.map((value) => value.channelId ?? value.channel?.id).find(Boolean);
  const userId = objects.map((value) => value.user?.id ?? value.author?.id ?? value.member?.user?.id ?? value.member?.id).find(Boolean);
  const commandName = objects.map((value) => value.commandName).find(Boolean);

  return {
    guildId,
    channelId,
    userId,
    command: commandName ? `/${commandName}` : null,
    source: eventName,
  };
}

/**
 * The language an event runs in: its server's, or the Discord language of the user for an interaction outside a server. Read
 * from memory (never waiting for the database) once per event: Discord's emitter calls every handler of one event in a row, so
 * the handlers after the first reuse its value. A new message or interaction also carries it as `pettoLang`.
 */
let lastEventObject = null;
let lastEventLang = null;
const CARRIES_LANGUAGE = new Set(['messageCreate', 'interactionCreate']);
function eventLanguage(eventName, guildId, args) {
  const first = args[0];
  if (first && first === lastEventObject) return lastEventLang;
  const locale = args.find((value) => value && typeof value === 'object' && typeof value.locale === 'string')?.locale;
  const lang = guildId ? peekGuildLanguage(guildId) : languageFromLocale(locale);
  if (first && typeof first === 'object') {
    lastEventObject = first;
    lastEventLang = lang;
    // Only for this event: objects Discord keeps (members, channels, the server) are not remembered past it.
    process.nextTick(() => { if (lastEventObject === first) lastEventObject = null; });
    if (CARRIES_LANGUAGE.has(eventName) && Object.isExtensible(first)) {
      try { first.pettoLang = lang; } catch { /* a read-only object keeps working without it */ }
    }
  }
  return lang;
}

/** The listener that is registered on the client for one event module: the blacklist check first, then the language of the server, then the handler. */
function makeInvoker(event, file, client, { countsEvent = true } = {}) {
  const name = String(file).replace(/\.js$/, '');
  const entry = perf.listenerEntry(event.name, name);
  // What a person waits for goes first in the queue of requests to Discord (utils/restGate.js): the answers to commands, buttons and menus.
  const interactive = event.name === 'interactionCreate' || name === 'messageCreateCommands';
  return (...args) => {
    if (countsEvent) perf.countEvent(event.name);
    // Under pressure (utils/loadGuard.js) the listeners that are not essential do not run: degraded drops the logs of low value, critical everything but the essential.
    if (!loadGuard.allowsEvent(name)) return;
    // A blacklisted server: no listener runs for it (nothing is written, sent or read), except the ones marked `blacklistExempt` (the one that leaves, and
    // guildDelete). It is read from memory, so this costs nothing and never waits for the database.
    if (guildBlacklist.blocksEvent(event, args)) {
      if (event.name === 'interactionCreate' && !blockedAnswered.has(args[0])) { blockedAnswered.add(args[0]); guildBlacklist.refuseInteraction(args[0]); }
      return;
    }
    const context = eventContext(event.name, args);
    // Each event runs inside the language of its server, so what it sends follows `!language` (see src/i18n).
    const lang = eventLanguage(event.name, context.guildId, args);
    // Each call of a listener is measured (the time it blocks the loop and the time it takes) and carries its context: the queries and requests it makes are counted for it.
    const perfContext = perf.newContext({ kind: 'event', name: `${event.name}/${name}`, interactive });
    logger.runWithContext(context, () => perf.runWith(perfContext, () => Promise.resolve()
      .then(() => perf.measureListener(entry, () => runWithLanguage(lang, () => event.execute(...args, client))))
      .then((value) => { perf.finishContext(perfContext); return value; }, (error) => { perf.finishContext(perfContext, error); throw error; })
      .catch((err) => (isPermissionError(err)
        ? logger.warn(`Missing permission in [event:${event.name}] (${file}): ${err.message} (code ${err.code})`)
        : logger.error(`[event:${event.name}] Handler failed (${file}):`, err)))));
  };
}

/**
 * Loads every event module and registers it on the client.
 * Each event file must export { name: string, once?: boolean, execute(...args) }.
 * `name` should match a discord.js Client event (e.g. Events.ClientReady).
 */
function loadEvents(client) {
  if (!fs.existsSync(EVENTS_DIR)) {
    logger.warn(`Events directory not found: ${EVENTS_DIR}`);
    return;
  }

  const counted = new Set();
  const files = fs.readdirSync(EVENTS_DIR).filter((file) => file.endsWith('.js'));
  let count = 0;

  for (const file of files) {
    const filePath = path.join(EVENTS_DIR, file);

    const event = require(filePath);

    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn(`Skipping invalid event file (missing "name" or "execute"): ${filePath}`);
      continue;
    }

    // The events by type are counted once, by the first listener of each type (the volume of events is what `!perf` shows).
    const invoke = makeInvoker(event, file, client, { countsEvent: !counted.has(event.name) });
    counted.add(event.name);

    if (event.once) client.once(event.name, invoke);
    else client.on(event.name, invoke);

    count += 1;
  }

  logger.info(`Loaded ${count} event(s).`);
}

module.exports = { loadEvents, makeInvoker };

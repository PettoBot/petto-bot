const { isPermissionError } = require('../utils/permissionErrors');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { guildLanguage, languageFromLocale, runWithLanguage } = require('../i18n');

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

/** The language an event runs in: its server's, or the Discord language of the user for an interaction outside a server. */
function eventLanguage(guildId, args) {
  if (guildId) return guildLanguage(guildId);
  const locale = args.find((value) => value && typeof value === 'object' && typeof value.locale === 'string')?.locale;
  return Promise.resolve(languageFromLocale(locale));
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

  const files = fs.readdirSync(EVENTS_DIR).filter((file) => file.endsWith('.js'));
  let count = 0;

  for (const file of files) {
    const filePath = path.join(EVENTS_DIR, file);

    const event = require(filePath);

    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn(`Skipping invalid event file (missing "name" or "execute"): ${filePath}`);
      continue;
    }

    const invoke = (...args) => {
      const context = eventContext(event.name, args);
      // Each event runs inside the language of its server, so what it sends follows `!language` (see src/i18n).
      logger.runWithContext(context, () => eventLanguage(context.guildId, args)
        .then((lang) => runWithLanguage(lang, () => event.execute(...args, client)))
        .catch((err) => (isPermissionError(err)
          ? logger.warn(`Missing permission in [event:${event.name}] (${file}): ${err.message} (code ${err.code})`)
          : logger.error(`[event:${event.name}] Handler failed (${file}):`, err))));
    };

    if (event.once) client.once(event.name, invoke);
    else client.on(event.name, invoke);

    count += 1;
  }

  logger.info(`Loaded ${count} event(s).`);
}

module.exports = { loadEvents };

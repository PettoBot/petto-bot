// i18n-ignore-file: internal protection (logs only).
// The quarantine the bot uses: one shared instance, with the essential work protected, an alert for the team when a part rests and comes back, and the wrappers for events and jobs.
const logger = require('./logger');
const { createQuarantine } = require('./quarantine');

const quarantine = createQuarantine({
  onChange: ({ key, state, failures, restMs, error }) => {
    if (state === 'resting') {
      // The team hears about it once: a part of the bot is apart until it works again. Everything else keeps running.
      logger.error(`[quarantine] ${key} failed ${failures} times in a minute and is resting for ${Math.round(restMs / 1000)}s (the rest of the bot keeps working). Last error: ${error}`);
    } else {
      logger.localWarn(`[quarantine] ${key} works again and is back.`);
    }
  },
});

// What is never put apart: the work the bot cannot do without (commands, moderation, tickets, verification, the guards, a punishment that expires).
quarantine.protect((key) => {
  const loadGuard = require('./loadGuard');
  const [kind, name] = key.split(':');
  if (kind === 'event') return loadGuard.essentialEvent(name);
  if (kind === 'job') return loadGuard.isEssentialJob(name);
  return false;
});

module.exports = quarantine;

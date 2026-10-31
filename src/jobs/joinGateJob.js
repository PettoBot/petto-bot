// Every minute, sends the welcomes that waited for Discord's onboarding and whose safety limit passed (the member skipped it, or Discord never
// set the flag that says it is done), and once an hour forgets the members who waited 7 days. A bot where nobody waits asks the database
// nothing: the numbers of who waits are in memory (utils/joinGate.js).
const joinGate = require('../utils/joinGate');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60_000;

function startJoinGateJob(client) {
  const run = exclusiveTask(async () => {
    joinGate.maintain();
    const sent = await joinGate.sendDue(client);
    if (sent) logger.info(`Welcome: sent ${sent} welcome(s) after the safety limit of the onboarding.`); // i18n-ignore: a log line for the operator
  });
  const tick = () => run().catch((error) => logger.error('Join welcome job failed:', error)); // i18n-ignore: a log line for the operator
  setTimeout(tick, 30_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startJoinGateJob };

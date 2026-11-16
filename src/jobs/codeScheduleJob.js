"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCodeScheduleJob = startCodeScheduleJob;
// i18n-ignore-file: only lines of the log of the host.
// Runs the commands that Petto Code scheduled with scheduleUniqueCC (db/commandData `schedule`): every few seconds the ones that are due are taken and run.
// They are kept in the database, so a restart does not lose them; one that was due while the bot was off runs when it is back.
const commandData = require('../db/commandData');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const POLL_MS = 10_000;
function startCodeScheduleJob(client, options = {}) {
    const run = exclusiveTask(async () => {
        const { runScheduled } = require('../utils/codeCommands');
        const due = await commandData.schedule.claimDue(20);
        for (const entry of due) {
            await runScheduled(client, entry).catch((error) => logger.error(`A scheduled command (${entry.name}) crashed in guild ${entry.guildId}:`, error));
        }
    });
    const tick = () => { run().catch((error) => logger.error('The job of the scheduled commands failed:', error)); };
    const first = setTimeout(tick, 15_000);
    const timer = setInterval(tick, options.pollMs ?? POLL_MS);
    first.unref?.();
    timer.unref?.();
    logger.info('Scheduled commands job started (looking every 10 seconds for commands that are due).');
    return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}

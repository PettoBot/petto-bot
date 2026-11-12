"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startActivityLeaderboardJob = startActivityLeaderboardJob;
const activityLeaderboard_1 = require("../utils/activityLeaderboard");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const loadGuard = require('../utils/loadGuard');
const POLL_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_MS = 2 * 60_000;
function startActivityLeaderboardJob(client) {
    const run = exclusiveTask(async () => {
        // Boards are not essential: when the bot is struggling they wait (they are only an hour late).
        if (loadGuard.level() === 'critical')
            return;
        await (0, activityLeaderboard_1.runDueBoards)(client);
    });
    const safe = () => { run().catch((error) => logger.error('Activity leaderboard job error:', error)); };
    setTimeout(safe, FIRST_RUN_MS).unref?.();
    setInterval(safe, POLL_INTERVAL_MS).unref?.();
    logger.info('Activity leaderboard job started (looking every 5 minutes for boards that are due).');
}

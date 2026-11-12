"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startActivityLeaderboardJob = startActivityLeaderboardJob;
const activityLeaderboard_1 = require("../utils/activityLeaderboard");
const activityTopRole_1 = require("../utils/activityTopRole");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const loadGuard = require('../utils/loadGuard');
// Every 15 seconds: a board is due 270 seconds after its last time (db/activityLeaderboards.ts `REFRESH_SECONDS`), so a board is looked at every 270 to 285 seconds. A look that finds nothing
// due is one small query; one that finds many goes on for up to 50 seconds and the next starts after it ends (`exclusiveTask`).
const POLL_INTERVAL_MS = 15_000;
const FIRST_RUN_MS = 2 * 60_000;
function startActivityLeaderboardJob(client) {
    const run = exclusiveTask(async () => {
        // Boards are not essential: when the bot is struggling they wait (the load guard also pauses this job when the bot is degraded, see `SHED_IN_DEGRADED_JOBS`).
        if (loadGuard.level() === 'critical')
            return;
        await (0, activityLeaderboard_1.runDueBoards)(client);
        await (0, activityTopRole_1.runDueRoles)(client); // the role of the most active member of the week that just ended, for the servers that asked for it
    });
    const safe = () => { run().catch((error) => logger.error('Activity leaderboard job error:', error)); };
    setTimeout(safe, FIRST_RUN_MS).unref?.();
    setInterval(safe, POLL_INTERVAL_MS).unref?.();
    logger.info('Activity leaderboard job started (looking every 15 seconds for boards and roles that are due).');
}

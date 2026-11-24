"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStreakJob = startStreakJob;
const streakRewards_1 = require("../utils/streakRewards");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const loadGuard = require('../utils/loadGuard');
const POLL_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_MS = 4 * 60_000;
function startStreakJob(client) {
    const run = exclusiveTask(async () => {
        if (loadGuard.level() !== 'normal')
            return; // the bot is struggling: it waits for the next look
        await (0, streakRewards_1.runStreakRewards)(client);
    });
    const safe = () => { run().catch((error) => logger.error('Streak job error:', error)); };
    setTimeout(safe, FIRST_RUN_MS).unref?.();
    setInterval(safe, POLL_INTERVAL_MS).unref?.();
    logger.info('Streak job started (looking every 10 minutes).');
}

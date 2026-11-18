"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAgedRolesJob = startAgedRolesJob;
const agedRoles_1 = require("../utils/agedRoles");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const loadGuard = require('../utils/loadGuard');
const POLL_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_MS = 3 * 60_000;
function startAgedRolesJob(client) {
    const run = exclusiveTask(async () => {
        if (loadGuard.level() !== 'normal')
            return; // the bot is struggling: it waits for the next look
        await (0, agedRoles_1.runAgedRoles)(client);
    });
    const safe = () => { run().catch((error) => logger.error('Aged roles job error:', error)); };
    setTimeout(safe, FIRST_RUN_MS).unref?.();
    setInterval(safe, POLL_INTERVAL_MS).unref?.();
    logger.info('Aged roles job started (looking every 30 minutes).');
}

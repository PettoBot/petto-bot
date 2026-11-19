"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPremiumWatchJob = startPremiumWatchJob;
const premiumWatch_1 = require("../utils/premiumWatch");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const FIRST_RUN_MS = 20_000;
function startPremiumWatchJob(client) {
    const state = (0, premiumWatch_1.newState)();
    const run = exclusiveTask(async () => { await (0, premiumWatch_1.watchOnce)(state, { client }); });
    const runLogged = () => { run().catch((error) => logger.error('Premium watch failed:', error)); };
    // The first look only remembers how everything is (what was before the start is not a change); it is after the cache and the database are ready.
    setTimeout(runLogged, FIRST_RUN_MS).unref?.();
    setInterval(runLogged, premiumWatch_1.WATCH_MS).unref?.();
    logger.info('Premium watch started (looking at Premium changes every 15 seconds).');
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStatsCategoryJob = startStatsCategoryJob;
const statsCategory_1 = require("../utils/statsCategory");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const config = require('../config');
const FIRST_RUN_MS = 45_000; // after the servers are in the cache, so the numbers are whole from the first time
function startStatsCategoryJob(client) {
    const run = exclusiveTask(async () => {
        const report = await (0, statsCategory_1.updateStatsCategory)(client, config.supportGuildId);
        if (report.skipped)
            logger.warn(`Stats category not updated: ${report.skipped}.`);
        else if (report.created.length || report.renamed.length)
            logger.info(`Stats category: created ${report.created.join(', ') || 'nothing'}; renamed ${report.renamed.join(', ') || 'nothing'}.`);
    });
    const runLogged = () => { run().catch((error) => logger.error('Stats category failed:', error)); };
    setTimeout(runLogged, FIRST_RUN_MS).unref?.();
    setInterval(runLogged, statsCategory_1.STATS_EVERY_MS).unref?.();
    logger.info('Stats category job started (every 10 minutes).');
}

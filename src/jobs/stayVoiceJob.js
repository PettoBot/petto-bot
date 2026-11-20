"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStayVoiceJob = startStayVoiceJob;
const stayVoice_1 = require("../utils/stayVoice");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const EVERY_MS = 20_000;
const FIRST_MS = 15_000;
function startStayVoiceJob(client) {
    const round = exclusiveTask(async () => {
        await (0, stayVoice_1.tick)(client);
    });
    const run = () => { round().catch((error) => logger.error('Stay in voice job error:', error)); };
    setTimeout(run, FIRST_MS).unref?.();
    setInterval(run, EVERY_MS).unref?.();
    logger.info('Stay in voice job started (looking at the servers that asked for it every 20 seconds).');
}

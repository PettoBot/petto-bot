"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMessageRolesJob = startMessageRolesJob;
const messageRoles_1 = require("../utils/messageRoles");
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const loadGuard = require('../utils/loadGuard');
const FLUSH_MS = 20_000;
const REMOVALS_MS = 30 * 60_000;
const PRUNE_MS = 24 * 3_600_000;
function startMessageRolesJob(client) {
    const flushing = exclusiveTask(async () => { await (0, messageRoles_1.flush)(client); }); // counting is never skipped when the bot is busy: it only writes in batches
    const removing = exclusiveTask(async () => {
        if (loadGuard.level() !== 'normal')
            return;
        await (0, messageRoles_1.runRemovals)(client);
    });
    const log = (name) => (error) => { logger.error(`Message roles ${name} error:`, error); };
    setInterval(() => { flushing().catch(log('flush')); }, FLUSH_MS).unref?.();
    setTimeout(() => { removing().catch(log('removals')); }, 5 * 60_000).unref?.();
    setInterval(() => { removing().catch(log('removals')); }, REMOVALS_MS).unref?.();
    setTimeout(() => { (0, messageRoles_1.prune)().catch(log('prune')); }, 10 * 60_000).unref?.();
    setInterval(() => { (0, messageRoles_1.prune)().catch(log('prune')); }, PRUNE_MS).unref?.();
    logger.info('Message roles job started (writing counts every 20 seconds, looking at removals every 30 minutes).');
}

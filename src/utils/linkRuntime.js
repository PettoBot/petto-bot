"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINK_PATH = exports.getClient = exports.getHub = void 0;
exports.ownership = ownership;
exports.linkUrl = linkUrl;
exports.startHub = startHub;
exports.startWorkerLink = startWorkerLink;
exports.relayEvent = relayEvent;
exports.sendFromWorker = sendFromWorker;
exports.stopAll = stopAll;
// i18n-ignore-file: internal plumbing between two instances of the bot (operator logs only).
// The pieces of the link (src/utils/instanceLink.ts) that live for as long as the process: the hub on the primary, the client on a worker, and what the rest of the bot calls (Redis messages, the web server).
const instanceLink_1 = require("./instanceLink");
Object.defineProperty(exports, "LINK_PATH", { enumerable: true, get: function () { return instanceLink_1.LINK_PATH; } });
let hub = null;
let client = null;
let keepAliveTimer = null;
const logger = () => require('./logger');
const log = (line) => logger().info(line);
/** The shards this instance holds (`DISCORD_SHARDS` as a list, `DISCORD_SHARD_COUNT`), or null when the servers are not split. */
function ownership(env = process.env) {
    const shards = (0, instanceLink_1.parseShards)(env.DISCORD_SHARDS);
    const count = Number(env.DISCORD_SHARD_COUNT);
    return shards && Number.isInteger(count) && count >= 1 ? { shards, count } : null;
}
/** The address of the link of the primary, from the address of its SQL bridge (`.../api/bridge/db` -> `wss://.../api/bridge/link`). */
function linkUrl(bridgeUrl) {
    return String(bridgeUrl).replace(/\/api\/bridge\/db\/?$/, '').replace(/\/$/, '').replace(/^http/i, 'ws') + instanceLink_1.LINK_PATH;
}
const getHub = () => hub;
exports.getHub = getHub;
const getClient = () => client;
exports.getClient = getClient;
/** Primary: the hub that takes the connections of the workers. */
function startHub(secret, onEvent) {
    if (hub)
        return hub;
    hub = (0, instanceLink_1.createLinkHub)({ secret, onEvent, log });
    keepAliveTimer = setInterval(() => hub?.keepAlive(), instanceLink_1.PING_EVERY_MS);
    keepAliveTimer.unref?.();
    return hub;
}
/** Worker: calls the primary and keeps the link open. `port` is where this instance's own copy of the web routes listens (127.0.0.1). */
function startWorkerLink({ bridgeUrl, secret, port, worker, env = process.env, onEvent }) {
    if (client)
        return client;
    const mine = ownership(env);
    if (!mine) {
        logger().warn('Link: a worker needs DISCORD_SHARDS (a list) and DISCORD_SHARD_COUNT to say which servers it holds; the link is off.');
        return null;
    }
    client = (0, instanceLink_1.createLinkClient)({ url: linkUrl(bridgeUrl), secret, worker, shards: mine.shards, count: mine.count, handle: (0, instanceLink_1.localHandler)(port), onEvent, log });
    client.start();
    return client;
}
/**
 * A message of `petto:<channel>` reached the primary (from Redis, or from a worker): the workers get it too, so their caches forget what changed.
 * Returns how many workers were told.
 */
function relayEvent(channel, message, except) {
    return hub ? hub.broadcast(channel, message, except) : 0;
}
/** A worker says a message of `petto:<channel>` (it has no Redis): it goes to the primary. False when the link is down. */
function sendFromWorker(channel, message) {
    return client ? client.sendEvent(channel, message) : false;
}
function stopAll() {
    client?.stop();
    client = null;
    hub?.close();
    hub = null;
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

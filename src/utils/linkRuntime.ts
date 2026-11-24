// i18n-ignore-file: internal plumbing between two instances of the bot (operator logs only).
// The pieces of the link (src/utils/instanceLink.ts) that live for as long as the process: the hub on the primary, the client on a worker, and what the rest of the bot calls (Redis messages, the web server).
import { createLinkHub, createLinkClient, localHandler, parseShards, LINK_PATH, PING_EVERY_MS, type LinkHub, type LinkClient, type Ownership } from './instanceLink';

type Env = Record<string, string | undefined>;
let hub: LinkHub | null = null;
let client: LinkClient | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

const logger = (): { info: (line: string) => void; warn: (line: string) => void } => require('./logger') as { info: (line: string) => void; warn: (line: string) => void };
const log = (line: string): void => logger().info(line);

/** The shards this instance holds (`DISCORD_SHARDS` as a list, `DISCORD_SHARD_COUNT`), or null when the servers are not split. */
export function ownership(env: Env = process.env): Ownership | null {
  const shards = parseShards(env.DISCORD_SHARDS);
  const count = Number(env.DISCORD_SHARD_COUNT);
  return shards && Number.isInteger(count) && count >= 1 ? { shards, count } : null;
}

/** The address of the link of the primary, from the address of its SQL bridge (`.../api/bridge/db` -> `wss://.../api/bridge/link`). */
export function linkUrl(bridgeUrl: string): string {
  return String(bridgeUrl).replace(/\/api\/bridge\/db\/?$/, '').replace(/\/$/, '').replace(/^http/i, 'ws') + LINK_PATH;
}

export const getHub = (): LinkHub | null => hub;
export const getClient = (): LinkClient | null => client;

/** Primary: the hub that takes the connections of the workers. */
export function startHub(secret: string, onEvent: (event: { channel: string; message: string; worker: string }) => void): LinkHub {
  if (hub) return hub;
  hub = createLinkHub({ secret, onEvent, log });
  keepAliveTimer = setInterval(() => hub?.keepAlive(), PING_EVERY_MS);
  keepAliveTimer.unref?.();
  return hub;
}

/** Worker: calls the primary and keeps the link open. `port` is where this instance's own copy of the web routes listens (127.0.0.1). */
export function startWorkerLink({ bridgeUrl, secret, port, worker, env = process.env, onEvent }: { bridgeUrl: string; secret: string; port: number; worker: string; env?: Env; onEvent: (event: { channel: string; message: string }) => void }): LinkClient | null {
  if (client) return client;
  const mine = ownership(env);
  if (!mine) { logger().warn('Link: a worker needs DISCORD_SHARDS (a list) and DISCORD_SHARD_COUNT to say which servers it holds; the link is off.'); return null; }
  client = createLinkClient({ url: linkUrl(bridgeUrl), secret, worker, shards: mine.shards, count: mine.count, handle: localHandler(port), onEvent, log });
  client.start();
  return client;
}

/**
 * A message of `petto:<channel>` reached the primary (from Redis, or from a worker): the workers get it too, so their caches forget what changed.
 * Returns how many workers were told.
 */
export function relayEvent(channel: string, message: string, except?: string): number {
  return hub ? hub.broadcast(channel, message, except) : 0;
}

/** A worker says a message of `petto:<channel>` (it has no Redis): it goes to the primary. False when the link is down. */
export function sendFromWorker(channel: string, message: string): boolean {
  return client ? client.sendEvent(channel, message) : false;
}

export function stopAll(): void {
  client?.stop(); client = null;
  hub?.close(); hub = null;
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

export { LINK_PATH };

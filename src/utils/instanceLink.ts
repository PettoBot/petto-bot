// i18n-ignore-file: internal plumbing between two instances of the bot (operator logs and answers for the other instance, never for a member).
// The link between the primary instance (Discloud, which has the database and the web API) and a worker (a VPS, Docker) that holds other shards. The worker calls the primary (a WebSocket that
// goes OUT from the worker, so the VPS needs no open port, no domain and no tunnel) and keeps it open. Over it:
//   - requests: the web API of the primary gets a dashboard request for a server that lives on a shard of the worker; it sends the request through the link, the worker answers it with its own copy of
//     the same routes (the worker listens only on 127.0.0.1 for this), and the primary gives the answer back as if it had done it;
//   - events: the messages the dashboard says on Redis (`petto:*`, "this setting changed, forget the cache") reach the worker, which has no Redis, and the ones the worker says reach the primary.
// A server belongs to the shard `(id >> 22) % shardCount`; each instance says which shards it holds when it connects. Everything is signed like the SQL bridge (HMAC over time, id and what is said).
// The pieces that do not need the network (the shard math, the frames, `hub`, `client`) are plain functions and classes, checked on their own (scripts/check-instance-link.js).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sign, validSecret, MAX_SKEW_MS } from '../db/sqlBridge';

export const LINK_PATH = '/api/bridge/link';
export const FORWARDED_HEADER = 'x-petto-forwarded';
export const REQUEST_TIMEOUT_MS = 25_000;
export const PING_EVERY_MS = 20_000;
export const MAX_FRAME_BYTES = 12 * 1024 * 1024;
const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'expect']);

// ---- Which server lives on which shard ----------------------------------------------------------------------------------------------------------------------------
/** The shard of a server: Discord's rule, `(id >> 22) % shardCount`. -1 for something that is not a server id. */
export function shardOfGuild(guildId: unknown, shardCount: number): number {
  if (!/^\d{5,20}$/.test(String(guildId ?? '')) || !Number.isInteger(shardCount) || shardCount < 1) return -1;
  try { return Number((BigInt(String(guildId)) >> 22n) % BigInt(shardCount)); } catch { return -1; }
}

/** The shards in `DISCORD_SHARDS` (a list like `0,1`), or null when they are not a list (`auto`, nothing). */
export function parseShards(raw: unknown): number[] | null {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text || text === 'auto') return null;
  const ids = text.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 0);
  return ids.length ? [...new Set(ids)] : null;
}

export interface Ownership { shards: number[]; count: number }
/** Whether an instance that holds `shards` of `count` has the server. With no list or no count there is no split: it has every server. */
export function owns(ownership: Ownership | null, guildId: unknown): boolean {
  if (!ownership || !ownership.shards.length || !(ownership.count >= 1)) return true;
  const shard = shardOfGuild(guildId, ownership.count);
  return shard < 0 || ownership.shards.includes(shard);
}

// ---- The frames -------------------------------------------------------------------------------------------------------------------------------------------------------
export interface LinkRequest { method: string; path: string; headers: Record<string, string>; body?: Buffer }
export interface LinkResponse { status: number; headers: Record<string, string>; body: Buffer }
type Frame =
  | { t: 'req'; id: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { t: 'res'; id: string; status: number; headers: Record<string, string>; body: string }
  | { t: 'event'; channel: string; message: string }
  | { t: 'ping' } | { t: 'pong' };

const encodeFrame = (frame: Frame): string => JSON.stringify(frame);
function decodeFrame(raw: unknown): Frame | null {
  try {
    const frame = JSON.parse(String(raw)) as Frame;
    return frame && typeof frame === 'object' && typeof (frame as { t?: unknown }).t === 'string' ? frame : null;
  } catch { return null; }
}

export function cleanHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || value === undefined || value === null) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

// ---- The hello: what a worker says when it connects (signed) -------------------------------------------------------------------------------------------------
export interface Hello { worker: string; shards: number[]; count: number }
export const helloHeaders = (secret: string, hello: Hello, now: number = Date.now()): Record<string, string> => {
  const body = Buffer.from(JSON.stringify(hello)).toString('base64');
  const id = randomBytes(12).toString('hex');
  return { 'x-bridge-time': String(now), 'x-bridge-id': id, 'x-bridge-hello': body, 'x-bridge-signature': sign(secret, now, id, body) };
};

export function verifyHello(secret: string, headers: Record<string, string | string[] | undefined>, now: number = Date.now()): Hello | null {
  const one = (name: string): string => { const value = headers[name]; return Array.isArray(value) ? value[0] ?? '' : value ?? ''; };
  const time = Number(one('x-bridge-time')); const id = one('x-bridge-id'); const body = one('x-bridge-hello'); const signature = one('x-bridge-signature');
  if (!Number.isFinite(time) || !/^[a-f0-9]{16,64}$/.test(id) || !/^[a-f0-9]{64}$/.test(signature) || !body || body.length > 4096) return null;
  if (Math.abs(now - time) > MAX_SKEW_MS) return null;
  const expected = Buffer.from(sign(secret, time, id, body)); const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const hello = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as Hello;
    if (typeof hello.worker !== 'string' || !/^[\w.-]{1,64}$/.test(hello.worker) || !Array.isArray(hello.shards) || !hello.shards.every((shard) => Number.isInteger(shard) && shard >= 0) || !Number.isInteger(hello.count) || hello.count < 1) return null;
    return { worker: hello.worker, shards: [...new Set(hello.shards)], count: hello.count };
  } catch { return null; }
}

// ---- The primary side --------------------------------------------------------------------------------------------------------------------------------------------
interface SocketLike { send(data: string): void; close(code?: number, reason?: string): void; terminate(): void; on(event: string, listener: (...args: unknown[]) => void): unknown; readyState: number }
interface Connected { socket: SocketLike; hello: Hello; seenAt: number }
interface Waiting { resolve: (value: LinkResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; worker: string }
const OPEN = 1;

export interface HubOptions { secret: string; now?: () => number; requestTimeoutMs?: number; onEvent?: (event: { channel: string; message: string; worker: string }) => void; log?: (line: string) => void }

export function createLinkHub({ secret, now = Date.now, requestTimeoutMs = REQUEST_TIMEOUT_MS, onEvent = () => {}, log = () => {} }: HubOptions) {
  if (!validSecret(secret)) throw new Error('PETTO_BRIDGE_SECRET needs at least 32 characters.');
  const workers = new Map<string, Connected>();
  const waiting = new Map<string, Waiting>();
  const usedIds = new Map<string, number>();

  const failWaiting = (worker: string, reason: string): void => {
    for (const [id, item] of waiting) if (item.worker === worker) { clearTimeout(item.timer); waiting.delete(id); item.reject(new Error(reason)); }
  };

  const hub = {
    /** Takes a connection that the HTTP server upgraded. Returns false (and the caller closes it) when the hello is not valid. */
    accept(socket: SocketLike, headers: Record<string, string | string[] | undefined>): boolean {
      const time = now();
      for (const [id, at] of usedIds) if (time - at > MAX_SKEW_MS * 2) usedIds.delete(id);
      const hello = verifyHello(secret, headers, time);
      const requestId = String((Array.isArray(headers['x-bridge-id']) ? headers['x-bridge-id'][0] : headers['x-bridge-id']) ?? '');
      if (!hello || usedIds.has(requestId)) return false;
      usedIds.set(requestId, time);
      const before = workers.get(hello.worker);
      if (before) { failWaiting(hello.worker, 'the worker connected again'); try { before.socket.terminate(); } catch { /* it was gone */ } }
      const entry: Connected = { socket, hello, seenAt: time };
      workers.set(hello.worker, entry);
      log(`Link: worker ${hello.worker} connected with shards ${hello.shards.join(',')} of ${hello.count}.`);
      socket.on('message', (raw: unknown) => {
        entry.seenAt = now();
        const frame = decodeFrame(raw);
        if (!frame) return;
        if (frame.t === 'res') {
          const item = waiting.get(frame.id);
          if (!item || item.worker !== hello.worker) return;
          clearTimeout(item.timer); waiting.delete(frame.id);
          item.resolve({ status: Number(frame.status) || 502, headers: cleanHeaders(frame.headers), body: Buffer.from(String(frame.body ?? ''), 'base64') });
        } else if (frame.t === 'event' && typeof frame.channel === 'string' && /^[\w:.-]{1,100}$/.test(frame.channel)) {
          onEvent({ channel: frame.channel, message: String(frame.message ?? '').slice(0, 10_000), worker: hello.worker });
        } else if (frame.t === 'ping') { try { socket.send(encodeFrame({ t: 'pong' })); } catch { /* closing */ } }
      });
      const gone = (): void => {
        if (workers.get(hello.worker) === entry) { workers.delete(hello.worker); failWaiting(hello.worker, 'the worker disconnected'); log(`Link: worker ${hello.worker} disconnected.`); }
      };
      socket.on('close', gone); socket.on('error', gone);
      return true;
    },

    /** The worker that holds the shard of a server, or null (the primary has it, or nobody does). */
    workerFor(guildId: unknown): string | null {
      for (const [name, { hello }] of workers) {
        const shard = shardOfGuild(guildId, hello.count);
        if (shard >= 0 && hello.shards.includes(shard)) return name;
      }
      return null;
    },

    /** Sends a web request to a worker and waits for its answer. */
    forward(worker: string, request: LinkRequest): Promise<LinkResponse> {
      const entry = workers.get(worker);
      if (!entry || entry.socket.readyState !== OPEN) return Promise.reject(new Error('the worker is not connected'));
      const id = randomBytes(10).toString('hex');
      return new Promise<LinkResponse>((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error('the worker did not answer in time')); }, requestTimeoutMs);
        timer.unref?.();
        waiting.set(id, { resolve, reject, timer, worker });
        try {
          entry.socket.send(encodeFrame({ t: 'req', id, method: request.method, path: request.path, headers: cleanHeaders(request.headers), body: request.body?.length ? request.body.toString('base64') : undefined }));
        } catch (error) { clearTimeout(timer); waiting.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
      });
    },

    /** Tells every worker (except `except`) that something changed (a message of `petto:<channel>`). */
    broadcast(channel: string, message: string, except?: string): number {
      let sent = 0;
      for (const [name, { socket }] of workers) {
        if (name === except || socket.readyState !== OPEN) continue;
        try { socket.send(encodeFrame({ t: 'event', channel, message })); sent += 1; } catch { /* that one is closing */ }
      }
      return sent;
    },

    /** A ping to each worker, and the ones that did not say anything for too long are cut (their requests fail at once). */
    keepAlive(): void {
      const time = now();
      for (const [name, entry] of workers) {
        if (time - entry.seenAt > PING_EVERY_MS * 2.5) { log(`Link: worker ${name} went quiet; closing.`); try { entry.socket.terminate(); } catch { /* gone */ } continue; }
        try { entry.socket.send(encodeFrame({ t: 'ping' })); } catch { /* closing */ }
      }
    },

    workersConnected: (): { worker: string; shards: number[]; count: number }[] => [...workers.values()].map(({ hello }) => ({ ...hello })),
    close(): void { for (const { socket } of workers.values()) { try { socket.terminate(); } catch { /* gone */ } } workers.clear(); for (const [id, item] of waiting) { clearTimeout(item.timer); waiting.delete(id); item.reject(new Error('closing')); } },
  };
  return hub;
}
export type LinkHub = ReturnType<typeof createLinkHub>;

// ---- The worker side ---------------------------------------------------------------------------------------------------------------------------------------------
type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;
export interface ClientOptions {
  url: string; secret: string; worker: string; shards: number[]; count: number;
  /** Answers a request of the primary with this instance's own routes. */
  handle: (request: LinkRequest) => Promise<LinkResponse>;
  onEvent?: (event: { channel: string; message: string }) => void;
  connect?: SocketFactory; now?: () => number; log?: (line: string) => void;
  backoffMs?: number[]; setTimer?: (fn: () => void, ms: number) => { unref?: () => void } & object;
}

export function createLinkClient({ url, secret, worker, shards, count, handle, onEvent = () => {}, connect, now = Date.now, log = () => {}, backoffMs = [1_000, 2_000, 5_000, 10_000, 30_000], setTimer = (fn, ms) => setTimeout(fn, ms) }: ClientOptions) {
  if (!validSecret(secret)) throw new Error('PETTO_BRIDGE_SECRET needs at least 32 characters.');
  let socket: SocketLike | null = null;
  let stopped = false;
  let failures = 0;
  let connectedAt = 0;
  let open = false;
  const factory: SocketFactory = connect ?? ((address, headers) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WebSocket = require('ws') as new (address: string, options: { headers: Record<string, string>; maxPayload: number }) => SocketLike;
    return new WebSocket(address, { headers, maxPayload: MAX_FRAME_BYTES });
  });

  const reconnect = (): void => {
    if (stopped) return;
    if (connectedAt && now() - connectedAt > 10_000) failures = 0; // it was stable: start the waits again from the short one
    const wait = backoffMs[Math.min(failures, backoffMs.length - 1)];
    failures += 1;
    const timer = setTimer(start, wait); timer.unref?.();
  };

  function start(): void {
    if (stopped || socket) return;
    let current: SocketLike;
    try { current = factory(url, helloHeaders(secret, { worker, shards, count }, now())); } catch (error) { log(`Link: could not connect (${error instanceof Error ? error.message : String(error)}).`); reconnect(); return; }
    socket = current;
    current.on('open', () => { open = true; connectedAt = now(); log(`Link: connected to the primary as ${worker}.`); });
    current.on('message', (raw: unknown) => {
      const frame = decodeFrame(raw);
      if (!frame) return;
      if (frame.t === 'req' && typeof frame.id === 'string') {
        const request: LinkRequest = { method: String(frame.method || 'GET').toUpperCase(), path: String(frame.path || '/'), headers: cleanHeaders(frame.headers), body: frame.body ? Buffer.from(frame.body, 'base64') : undefined };
        handle(request).then((response) => ({ status: response.status, headers: cleanHeaders(response.headers), body: response.body }), () => ({ status: 502, headers: {}, body: Buffer.from(JSON.stringify({ ok: false, error: 'worker_error' })) }))
          .then((response) => { try { current.send(encodeFrame({ t: 'res', id: frame.id, status: response.status, headers: response.headers, body: response.body.toString('base64') })); } catch { /* the link closed: the primary already gave up */ } });
      } else if (frame.t === 'event' && typeof frame.channel === 'string') onEvent({ channel: frame.channel, message: String(frame.message ?? '') });
      else if (frame.t === 'ping') { try { current.send(encodeFrame({ t: 'pong' })); } catch { /* closing */ } }
    });
    const closed = (): void => { if (socket !== current) return; socket = null; open = false; reconnect(); };
    current.on('close', closed);
    current.on('error', () => { /* `close` follows */ });
    // `unexpected-response` (the primary said no: wrong secret, no link) is a close for us.
    current.on('unexpected-response', closed);
  }

  return {
    start,
    stop(): void { stopped = true; try { socket?.terminate(); } catch { /* gone */ } socket = null; open = false; },
    isConnected: (): boolean => open,
    /** Tells the primary that something changed here (a message of `petto:<channel>`). False when the link is down. */
    sendEvent(channel: string, message: string): boolean {
      if (!socket || !open) return false;
      try { socket.send(encodeFrame({ t: 'event', channel, message: String(message) })); return true; } catch { return false; }
    },
  };
}
export type LinkClient = ReturnType<typeof createLinkClient>;

// ---- The two doors of an Express app ---------------------------------------------------------------------------------------------------------------------------
interface ExpressRequest { method: string; originalUrl: string; headers: Record<string, unknown>; body?: unknown; is(type: string): unknown; on(event: string, listener: (...args: unknown[]) => void): unknown; get(name: string): string | undefined }
interface ExpressResponse { status(code: number): ExpressResponse; set(name: string, value: string): ExpressResponse; send(body: Buffer | string): ExpressResponse; json(body: unknown): ExpressResponse; headersSent: boolean }

async function bodyOf(req: ExpressRequest, limit: number = MAX_FRAME_BYTES): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.is('json') && req.body !== undefined) return Buffer.from(JSON.stringify(req.body)); // the parser of the app already read it
  return new Promise<Buffer | undefined>((resolve, reject) => {
    const parts: Buffer[] = []; let size = 0;
    req.on('data', (chunk: unknown) => { const piece = Buffer.from(chunk as Buffer); size += piece.length; if (size > limit) { reject(new Error('too large')); return; } parts.push(piece); });
    req.on('end', () => resolve(parts.length ? Buffer.concat(parts) : undefined));
    req.on('error', reject);
  });
}

/**
 * Called from `app.param('guildId')` of the primary: if the server lives on a shard of a connected worker the request goes through the link and `true` is returned (the answer is already sent);
 * otherwise `false` and the route goes on here. A request that came from the link (`x-petto-forwarded`) is never sent again. A server of a worker that is not connected answers 503.
 */
export async function routeGuildRequest(hub: LinkHub, owner: Ownership | null, req: ExpressRequest, res: ExpressResponse, guildId: string): Promise<boolean> {
  if (req.get(FORWARDED_HEADER)) return false;
  const worker = hub.workerFor(guildId);
  if (!worker) {
    // No worker holds it. If this instance holds its shard (or there is no split) it is ours; if it does not, the shard is nobody's right now.
    if (owns(owner, guildId)) return false;
    res.status(503).json({ ok: false, error: 'shard_unavailable' });
    return true;
  }
  try {
    const body = await bodyOf(req);
    const answer = await hub.forward(worker, { method: req.method, path: req.originalUrl, headers: { ...cleanHeaders(req.headers), [FORWARDED_HEADER]: '1' }, body });
    for (const [name, value] of Object.entries(answer.headers)) res.set(name, value);
    res.status(answer.status).send(answer.body);
  } catch (error) {
    if (!res.headersSent) res.status(503).json({ ok: false, error: error instanceof Error && /time/.test(error.message) ? 'shard_timeout' : 'shard_unavailable' });
  }
  return true;
}

/** The worker's answer to a request of the primary: the same routes, served on 127.0.0.1 by this instance. */
export function localHandler(port: number, fetcher: typeof fetch = fetch): (request: LinkRequest) => Promise<LinkResponse> {
  return async (request) => {
    const response = await fetcher(`http://127.0.0.1:${port}${request.path}`, {
      method: request.method, headers: { ...request.headers, [FORWARDED_HEADER]: '1' }, body: request.body && request.method !== 'GET' && request.method !== 'HEAD' ? new Uint8Array(request.body) : undefined,
      redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS - 2_000),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
  };
}

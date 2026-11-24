// i18n-ignore-file: internal plumbing between two instances of the bot; its errors go to the operator's log and never to a member.
// The SQL bridge: a second instance of the bot (a VPS, a Docker container) that cannot reach Petto's Discloud database by itself sends its SQL, signed, over HTTPS to the
// instance that can, and that one runs it with its own pool. Everything that talks to the database goes through `pool.query(text, values)` or `pool.connect()`, so
// the second instance only needs a pool that looks like the one of `pg`: the rest of the bot does not change.
//
//   server side   `createBridgeServer({ pool, secret })` -> `handle(request)`: checks the signature, runs the query (or keeps a connection for a transaction) and answers.
//   client side   `createBridgePool({ url, secret })`    -> `{ query, connect, on, end }`, the same shape as `pg.Pool` for what Petto uses.
//
// Safety: this is as strong as the secret, because whoever holds it can run any SQL, so (1) every request is signed with HMAC-SHA256 over its time, its id and the hash
// of its body (`PETTO_BRIDGE_SECRET`, at least 32 characters), (2) a request older than a minute or with a repeated id is refused, (3) the body is capped, the number of
// requests running at once is capped, and a transaction that is left open is rolled back after 30 seconds. Use it over HTTPS only.
// Plain functions and no Discord, so it is checked on its own (scripts/check-sql-bridge.js).
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MIN_SECRET_LENGTH = 32;
export const MAX_SKEW_MS = 60_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_RUNNING = 24;
export const MAX_SESSIONS = 8;
export const SESSION_TTL_MS = 30_000;
const REMEMBERED_IDS = 1_000;

// ---- What travels: JSON cannot carry a Date or a Buffer, and `pg` gives (and takes) both, so they are tagged -------------------------------------------------------
type Tagged = { $d: string } | { $b: string } | { $o: Record<string, unknown> } | { $u: 1 };

/** A value of a query (or of a row) as JSON: a Date, a Buffer, undefined and an object that already uses a key with `$` are tagged so they come back the same. */
export function encode(value: unknown): unknown {
  if (value === undefined) return { $u: 1 } satisfies Tagged;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $o: { n: String(value) } };
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return { $d: Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString() } satisfies Tagged;
  if (Buffer.isBuffer(value)) return { $b: value.toString('base64') } satisfies Tagged;
  if (value instanceof Uint8Array) return { $b: Buffer.from(value).toString('base64') } satisfies Tagged;
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encode(item)] as const);
    const plain = Object.fromEntries(entries);
    return entries.some(([key]) => key.startsWith('$')) ? ({ $o: plain } satisfies Tagged) : plain;
  }
  return String(value);
}

/** The opposite of `encode`. */
export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    if (keys.length === 1) {
      if (keys[0] === '$d') return object.$d === 'invalid' ? new Date(NaN) : new Date(String(object.$d));
      if (keys[0] === '$b') return Buffer.from(String(object.$b), 'base64');
      if (keys[0] === '$u') return undefined;
      if (keys[0] === '$o') {
        const inner = object.$o as Record<string, unknown>;
        // The one made for a number that JSON cannot hold (NaN, Infinity).
        if (Object.keys(inner).length === 1 && typeof inner.n === 'string' && ['NaN', 'Infinity', '-Infinity'].includes(inner.n)) return Number(inner.n);
        return Object.fromEntries(Object.entries(inner).map(([key, item]) => [key, decode(item)]));
      }
    }
    return Object.fromEntries(keys.map((key) => [key, decode(object[key])]));
  }
  return value;
}

// ---- The signature ---------------------------------------------------------------------------------------------------------------------------------------------
const bodyHash = (body: string): string => createHash('sha256').update(body).digest('hex');
export const sign = (secret: string, timestamp: number | string, id: string, body: string): string => createHmac('sha256', secret).update(`${timestamp}.${id}.${bodyHash(body)}`).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const validSecret = (secret: unknown): secret is string => typeof secret === 'string' && secret.trim().length >= MIN_SECRET_LENGTH;

// ---- What a database error carries (the code is what Petto's own code reads: 23505 is a duplicate, and so on) ------------------------------------------------------
const ERROR_FIELDS = ['code', 'detail', 'hint', 'constraint', 'table', 'column', 'schema', 'severity', 'routine', 'position'] as const;
function describeError(error: unknown): Record<string, unknown> {
  const e = error as Record<string, unknown> | null;
  const out: Record<string, unknown> = { message: String(e?.message ?? error ?? 'error').slice(0, 2000) };
  for (const field of ERROR_FIELDS) if (e && e[field] !== undefined) out[field] = e[field];
  return out;
}

export interface BridgeRequest { headers: Record<string, string | undefined>; body: string }
export interface BridgeResponse { status: number; json: Record<string, unknown> }
interface PoolLike { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null; command?: string; fields?: { name: string; dataTypeID?: number }[] }>; connect: () => Promise<ClientLike> }
interface ClientLike { query: PoolLike['query']; release: (error?: unknown) => void }
export interface BridgeServerOptions { pool: PoolLike; secret: string; now?: () => number; maxRunning?: number; maxSessions?: number; sessionTtlMs?: number; maxSkewMs?: number }

export function createBridgeServer({ pool, secret, now = Date.now, maxRunning = MAX_RUNNING, maxSessions = MAX_SESSIONS, sessionTtlMs = SESSION_TTL_MS, maxSkewMs = MAX_SKEW_MS }: BridgeServerOptions) {
  if (!validSecret(secret)) throw new Error(`PETTO_BRIDGE_SECRET needs at least ${MIN_SECRET_LENGTH} characters.`);
  const seen = new Map<string, number>(); // request id -> time (the same id twice is a replay, or a retry that already ran)
  const answers = new Map<string, BridgeResponse>(); // the answer of a request that ran, so a retry of it (the answer got lost) gets the same one instead of running twice
  const sessions = new Map<string, { client: ClientLike; touched: number }>();
  let running = 0;

  const reap = (): void => {
    const time = now();
    for (const [id, session] of sessions) {
      if (time - session.touched < sessionTtlMs) continue;
      sessions.delete(id);
      // The transaction that was left open is rolled back before the connection goes back to the pool.
      session.client.query('ROLLBACK').catch(() => {}).finally(() => session.client.release());
    }
    for (const [id, at] of seen) if (time - at > maxSkewMs * 2) { seen.delete(id); answers.delete(id); }
    while (seen.size > REMEMBERED_IDS) { const first = seen.keys().next().value as string; seen.delete(first); answers.delete(first); }
  };

  const run = async (client: PoolLike | ClientLike, text: unknown, values: unknown): Promise<BridgeResponse> => {
    if (typeof text !== 'string' || !text || text.length > MAX_BODY_BYTES) return { status: 400, json: { ok: false, error: { message: 'Invalid query.' } } };
    const params = Array.isArray(values) ? values.map(decode) : undefined;
    try {
      const result = await client.query(text, params);
      return { status: 200, json: { ok: true, result: { rows: encode(result.rows), rowCount: result.rowCount, command: result.command ?? null, fields: (result.fields ?? []).map((field) => ({ name: field.name, dataTypeID: field.dataTypeID ?? 0 })) } } };
    } catch (error) {
      return { status: 200, json: { ok: false, error: describeError(error) } }; // a database error is an answer, not a failure of the bridge
    }
  };

  return {
    /** Answers one request of the bridge. Never throws. */
    async handle({ headers, body }: BridgeRequest): Promise<BridgeResponse> {
      reap();
      const timestamp = Number(headers['x-bridge-time']);
      const id = String(headers['x-bridge-id'] ?? '');
      const signature = String(headers['x-bridge-signature'] ?? '');
      if (!Number.isFinite(timestamp) || !/^[a-f0-9]{16,64}$/.test(id) || !/^[a-f0-9]{64}$/.test(signature)) return { status: 401, json: { ok: false, error: { message: 'unauthorized' } } };
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { status: 413, json: { ok: false, error: { message: 'too large' } } };
      if (!safeEqual(signature, sign(secret, timestamp, id, body))) return { status: 401, json: { ok: false, error: { message: 'unauthorized' } } };
      const time = now();
      if (Math.abs(time - timestamp) > maxSkewMs) return { status: 401, json: { ok: false, error: { message: 'stale' } } };
      if (seen.has(id)) return answers.get(id) ?? { status: 409, json: { ok: false, error: { message: 'repeated' } } }; // a retry gets the answer it already had
      seen.set(id, time);
      if (running >= maxRunning) { seen.delete(id); return { status: 429, json: { ok: false, error: { message: 'busy' } } }; }
      running += 1;
      try {
        let payload: { op?: string; text?: unknown; values?: unknown; session?: unknown };
        try { payload = JSON.parse(body) as typeof payload; } catch { return { status: 400, json: { ok: false, error: { message: 'Invalid body.' } } }; }
        let response: BridgeResponse;
        if (payload.op === 'connect') {
          if (sessions.size >= maxSessions) response = { status: 429, json: { ok: false, error: { message: 'too many sessions' } } };
          else {
            const client = await pool.connect();
            const session = randomBytes(12).toString('hex');
            sessions.set(session, { client, touched: now() });
            response = { status: 200, json: { ok: true, session } };
          }
        } else if (payload.op === 'release') {
          const session = sessions.get(String(payload.session));
          if (session) {
            sessions.delete(String(payload.session));
            // A connection that is given back inside a transaction would carry it to the next one: it is rolled back first.
            await session.client.query('ROLLBACK').catch(() => {});
            session.client.release();
          }
          response = { status: 200, json: { ok: true } };
        } else if (payload.op === 'query') {
          if (payload.session !== undefined) {
            const session = sessions.get(String(payload.session));
            if (!session) response = { status: 410, json: { ok: false, error: { message: 'session expired' } } };
            else { session.touched = now(); response = await run(session.client, payload.text, payload.values); }
          } else response = await run(pool, payload.text, payload.values);
        } else response = { status: 400, json: { ok: false, error: { message: 'Unknown operation.' } } };
        answers.set(id, response);
        return response;
      } catch (error) {
        const response: BridgeResponse = { status: 502, json: { ok: false, error: describeError(error) } };
        seen.delete(id); // nothing ran: a retry may run
        return response;
      } finally { running -= 1; }
    },
    /** For the checks and the shutdown. */
    openSessions: (): number => sessions.size,
    close(): void { for (const [id, session] of sessions) { sessions.delete(id); session.client.query('ROLLBACK').catch(() => {}).finally(() => session.client.release()); } },
  };
}

// ---- The pool of the second instance ---------------------------------------------------------------------------------------------------------------------------
export interface BridgePoolOptions { url: string; secret: string; fetcher?: typeof fetch; timeoutMs?: number; retries?: number; now?: () => number; wait?: (ms: number) => Promise<void> }

export class BridgeError extends Error {
  code?: string; detail?: string; hint?: string; constraint?: string; table?: string; column?: string; schema?: string;
  constructor(info: Record<string, unknown>) {
    super(String(info?.message ?? 'bridge error'));
    this.name = 'BridgeError';
    for (const field of ERROR_FIELDS) if (info?.[field] !== undefined) (this as unknown as Record<string, unknown>)[field] = info[field];
  }
}

export function createBridgePool({ url, secret, fetcher = fetch, timeoutMs = 15_000, retries = 2, now = Date.now, wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: BridgePoolOptions) {
  if (!validSecret(secret)) throw new Error(`PETTO_BRIDGE_SECRET needs at least ${MIN_SECRET_LENGTH} characters.`);
  if (!/^https?:\/\//i.test(url)) throw new Error('PETTO_DB_BRIDGE_URL must be an http(s) address.');

  async function post(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload);
    const id = randomBytes(12).toString('hex'); // the same id on every try: if the answer got lost the server gives the one it already had instead of running twice
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timestamp = now();
      try {
        const response = await fetcher(url, {
          method: 'POST', signal: AbortSignal.timeout(timeoutMs), body,
          headers: { 'Content-Type': 'application/octet-stream', 'x-bridge-time': String(timestamp), 'x-bridge-id': id, 'x-bridge-signature': sign(secret, timestamp, id, body) },
        });
        const json = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (response.status === 429 || response.status >= 502) { lastError = new Error(`the bridge answered ${response.status}`); await wait(200 * (attempt + 1)); continue; }
        if (!json) throw new Error(`the bridge answered ${response.status} without a body`);
        return json;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await wait(200 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function query(text: string, values?: unknown[], session?: string): Promise<{ rows: unknown[]; rowCount: number | null; command: string | null; fields: { name: string; dataTypeID: number }[] }> {
    const answer = await post({ op: 'query', text, values: values ? values.map(encode) : undefined, ...(session ? { session } : {}) });
    if (!answer.ok) throw new BridgeError((answer.error ?? {}) as Record<string, unknown>);
    const result = answer.result as { rows: unknown; rowCount: number | null; command: string | null; fields: { name: string; dataTypeID: number }[] };
    return { ...result, rows: decode(result.rows) as unknown[] };
  }

  const counters = { running: 0 };
  return {
    isBridge: true as const,
    totalCount: 0, idleCount: 0, waitingCount: 0,
    /** Same as `pool.query(text, values)` (the callback form is not used by Petto). */
    async query(text: unknown, values?: unknown): Promise<ReturnType<typeof query> extends Promise<infer R> ? R : never> {
      const sql = typeof text === 'string' ? text : String((text as { text?: string } | null)?.text ?? '');
      const params = Array.isArray(values) ? values : (text as { values?: unknown[] } | null)?.values;
      counters.running += 1;
      try { return await query(sql, params); } finally { counters.running -= 1; }
    },
    /** A connection kept on the other side, for a transaction (BEGIN ... COMMIT). `release()` gives it back (and rolls back what was left open). */
    async connect() {
      const answer = await post({ op: 'connect' });
      if (!answer.ok) throw new BridgeError((answer.error ?? {}) as Record<string, unknown>);
      const session = String(answer.session);
      let released = false;
      return {
        query: async (text: unknown, values?: unknown): Promise<Awaited<ReturnType<typeof query>>> => {
          if (released) throw new Error('Client has already been released.');
          const sql = typeof text === 'string' ? text : String((text as { text?: string } | null)?.text ?? '');
          return query(sql, Array.isArray(values) ? values : (text as { values?: unknown[] } | null)?.values, session);
        },
        release: (): void => { if (released) return; released = true; post({ op: 'release', session }).catch(() => {}); },
      };
    },
    on(): void { /* the errors of a connection are the ones of a request here */ },
    async end(): Promise<void> { /* nothing is kept open */ },
  };
}

export type BridgePool = ReturnType<typeof createBridgePool>;
export type BridgeServer = ReturnType<typeof createBridgeServer>;

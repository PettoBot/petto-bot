"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeError = exports.MAX_BATCH = exports.validSecret = exports.sign = exports.SESSION_TTL_MS = exports.MAX_SESSIONS = exports.MAX_RUNNING = exports.MAX_BODY_BYTES = exports.MAX_SKEW_MS = exports.MIN_SECRET_LENGTH = void 0;
exports.encode = encode;
exports.decode = decode;
exports.createBridgeServer = createBridgeServer;
exports.cacheable = cacheable;
exports.createBridgePool = createBridgePool;
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
const node_crypto_1 = require("node:crypto");
exports.MIN_SECRET_LENGTH = 32;
exports.MAX_SKEW_MS = 60_000;
exports.MAX_BODY_BYTES = 2 * 1024 * 1024;
exports.MAX_RUNNING = 24;
exports.MAX_SESSIONS = 8;
exports.SESSION_TTL_MS = 30_000;
const REMEMBERED_IDS = 1_000;
/** A value of a query (or of a row) as JSON: a Date, a Buffer, undefined and an object that already uses a key with `$` are tagged so they come back the same. */
function encode(value) {
    if (value === undefined)
        return { $u: 1 };
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : { $o: { n: String(value) } };
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Date)
        return { $d: Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString() };
    if (Buffer.isBuffer(value))
        return { $b: value.toString('base64') };
    if (value instanceof Uint8Array)
        return { $b: Buffer.from(value).toString('base64') };
    if (Array.isArray(value))
        return value.map(encode);
    if (typeof value === 'object') {
        const entries = Object.entries(value).map(([key, item]) => [key, encode(item)]);
        const plain = Object.fromEntries(entries);
        return entries.some(([key]) => key.startsWith('$')) ? { $o: plain } : plain;
    }
    return String(value);
}
/** The opposite of `encode`. */
function decode(value) {
    if (Array.isArray(value))
        return value.map(decode);
    if (value && typeof value === 'object') {
        const object = value;
        const keys = Object.keys(object);
        if (keys.length === 1) {
            if (keys[0] === '$d')
                return object.$d === 'invalid' ? new Date(NaN) : new Date(String(object.$d));
            if (keys[0] === '$b')
                return Buffer.from(String(object.$b), 'base64');
            if (keys[0] === '$u')
                return undefined;
            if (keys[0] === '$o') {
                const inner = object.$o;
                // The one made for a number that JSON cannot hold (NaN, Infinity).
                if (Object.keys(inner).length === 1 && typeof inner.n === 'string' && ['NaN', 'Infinity', '-Infinity'].includes(inner.n))
                    return Number(inner.n);
                return Object.fromEntries(Object.entries(inner).map(([key, item]) => [key, decode(item)]));
            }
        }
        return Object.fromEntries(keys.map((key) => [key, decode(object[key])]));
    }
    return value;
}
// ---- The signature ---------------------------------------------------------------------------------------------------------------------------------------------
const bodyHash = (body) => (0, node_crypto_1.createHash)('sha256').update(body).digest('hex');
const sign = (secret, timestamp, id, body) => (0, node_crypto_1.createHmac)('sha256', secret).update(`${timestamp}.${id}.${bodyHash(body)}`).digest('hex');
exports.sign = sign;
function safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && (0, node_crypto_1.timingSafeEqual)(left, right);
}
const validSecret = (secret) => typeof secret === 'string' && secret.trim().length >= exports.MIN_SECRET_LENGTH;
exports.validSecret = validSecret;
// ---- What a database error carries (the code is what Petto's own code reads: 23505 is a duplicate, and so on) ------------------------------------------------------
const ERROR_FIELDS = ['code', 'detail', 'hint', 'constraint', 'table', 'column', 'schema', 'severity', 'routine', 'position'];
function describeError(error) {
    const e = error;
    const out = { message: String(e?.message ?? error ?? 'error').slice(0, 2000) };
    for (const field of ERROR_FIELDS)
        if (e && e[field] !== undefined)
            out[field] = e[field];
    return out;
}
exports.MAX_BATCH = 32;
function createBridgeServer({ pool, pools, secret, now = Date.now, maxRunning = exports.MAX_RUNNING, maxSessions = exports.MAX_SESSIONS, sessionTtlMs = exports.SESSION_TTL_MS, maxSkewMs = exports.MAX_SKEW_MS }) {
    if (!(0, exports.validSecret)(secret))
        throw new Error(`PETTO_BRIDGE_SECRET needs at least ${exports.MIN_SECRET_LENGTH} characters.`);
    const map = pools ?? { primary: () => pool ?? null };
    const poolOf = (name) => {
        const key = name === undefined || name === null ? 'primary' : String(name);
        if (!Object.prototype.hasOwnProperty.call(map, key))
            return null;
        try {
            return map[key]() ?? null;
        }
        catch {
            return null;
        }
    };
    const seen = new Map(); // request id -> time (the same id twice is a replay, or a retry that already ran)
    const answers = new Map(); // the answer of a request that ran, so a retry of it (the answer got lost) gets the same one instead of running twice
    const sessions = new Map();
    let running = 0;
    const reap = () => {
        const time = now();
        for (const [id, session] of sessions) {
            if (time - session.touched < sessionTtlMs)
                continue;
            sessions.delete(id);
            // The transaction that was left open is rolled back before the connection goes back to the pool.
            session.client.query('ROLLBACK').catch(() => { }).finally(() => session.client.release());
        }
        for (const [id, at] of seen)
            if (time - at > maxSkewMs * 2) {
                seen.delete(id);
                answers.delete(id);
            }
        while (seen.size > REMEMBERED_IDS) {
            const first = seen.keys().next().value;
            seen.delete(first);
            answers.delete(first);
        }
    };
    const run = async (client, text, values) => {
        if (typeof text !== 'string' || !text || text.length > exports.MAX_BODY_BYTES)
            return { status: 400, json: { ok: false, error: { message: 'Invalid query.' } } };
        const params = Array.isArray(values) ? values.map(decode) : undefined;
        try {
            const result = await client.query(text, params);
            return { status: 200, json: { ok: true, result: { rows: encode(result.rows), rowCount: result.rowCount, command: result.command ?? null, fields: (result.fields ?? []).map((field) => ({ name: field.name, dataTypeID: field.dataTypeID ?? 0 })) } } };
        }
        catch (error) {
            return { status: 200, json: { ok: false, error: describeError(error) } }; // a database error is an answer, not a failure of the bridge
        }
    };
    return {
        /** Answers one request of the bridge. Never throws. */
        async handle({ headers, body }) {
            reap();
            const timestamp = Number(headers['x-bridge-time']);
            const id = String(headers['x-bridge-id'] ?? '');
            const signature = String(headers['x-bridge-signature'] ?? '');
            if (!Number.isFinite(timestamp) || !/^[a-f0-9]{16,64}$/.test(id) || !/^[a-f0-9]{64}$/.test(signature))
                return { status: 401, json: { ok: false, error: { message: 'unauthorized' } } };
            if (Buffer.byteLength(body) > exports.MAX_BODY_BYTES)
                return { status: 413, json: { ok: false, error: { message: 'too large' } } };
            if (!safeEqual(signature, (0, exports.sign)(secret, timestamp, id, body)))
                return { status: 401, json: { ok: false, error: { message: 'unauthorized' } } };
            const time = now();
            if (Math.abs(time - timestamp) > maxSkewMs)
                return { status: 401, json: { ok: false, error: { message: 'stale' } } };
            if (seen.has(id))
                return answers.get(id) ?? { status: 409, json: { ok: false, error: { message: 'repeated' } } }; // a retry gets the answer it already had
            seen.set(id, time);
            if (running >= maxRunning) {
                seen.delete(id);
                return { status: 429, json: { ok: false, error: { message: 'busy' } } };
            }
            running += 1;
            try {
                let payload;
                try {
                    payload = JSON.parse(body);
                }
                catch {
                    return { status: 400, json: { ok: false, error: { message: 'Invalid body.' } } };
                }
                let response;
                const target = poolOf(payload.db);
                if (payload.op === 'info') {
                    response = { status: 200, json: { ok: true, targets: Object.keys(map).filter((name) => poolOf(name)) } };
                }
                else if (payload.op !== 'release' && !(payload.op === 'query' && payload.session !== undefined) && !target) {
                    response = { status: 400, json: { ok: false, error: { message: 'Unknown database.' } } };
                }
                else if (payload.op === 'batch') {
                    // Several independent queries that left the other instance in the same moment: one trip, run together (never inside a transaction: those use a session).
                    const items = Array.isArray(payload.items) ? payload.items.slice(0, exports.MAX_BATCH) : [];
                    const results = await Promise.all(items.map((item) => run(target, item?.text, item?.values)));
                    response = { status: 200, json: { ok: true, results: results.map((result) => result.json) } };
                }
                else if (payload.op === 'connect') {
                    if (sessions.size >= maxSessions)
                        response = { status: 429, json: { ok: false, error: { message: 'too many sessions' } } };
                    else {
                        const client = await target.connect();
                        const session = (0, node_crypto_1.randomBytes)(12).toString('hex');
                        sessions.set(session, { client, touched: now() });
                        response = { status: 200, json: { ok: true, session } };
                    }
                }
                else if (payload.op === 'release') {
                    const session = sessions.get(String(payload.session));
                    if (session) {
                        sessions.delete(String(payload.session));
                        // A connection that is given back inside a transaction would carry it to the next one: it is rolled back first.
                        await session.client.query('ROLLBACK').catch(() => { });
                        session.client.release();
                    }
                    response = { status: 200, json: { ok: true } };
                }
                else if (payload.op === 'query') {
                    if (payload.session !== undefined) {
                        const session = sessions.get(String(payload.session));
                        if (!session)
                            response = { status: 410, json: { ok: false, error: { message: 'session expired' } } };
                        else {
                            session.touched = now();
                            response = await run(session.client, payload.text, payload.values);
                        }
                    }
                    else
                        response = await run(target, payload.text, payload.values);
                }
                else
                    response = { status: 400, json: { ok: false, error: { message: 'Unknown operation.' } } };
                answers.set(id, response);
                return response;
            }
            catch (error) {
                const response = { status: 502, json: { ok: false, error: describeError(error) } };
                seen.delete(id); // nothing ran: a retry may run
                return response;
            }
            finally {
                running -= 1;
            }
        },
        /** For the checks and the shutdown. */
        openSessions: () => sessions.size,
        close() { for (const [id, session] of sessions) {
            sessions.delete(id);
            session.client.query('ROLLBACK').catch(() => { }).finally(() => session.client.release());
        } },
    };
}
class BridgeError extends Error {
    code;
    detail;
    hint;
    constraint;
    table;
    column;
    schema;
    constructor(info) {
        super(String(info?.message ?? 'bridge error'));
        this.name = 'BridgeError';
        for (const field of ERROR_FIELDS)
            if (info?.[field] !== undefined)
                this[field] = info[field];
    }
}
exports.BridgeError = BridgeError;
/** A SELECT that may be remembered for a few seconds: no lock, no clock, no random, no sequence, no advisory lock. */
function cacheable(sql) {
    return /^\s*(with\b[\s\S]*?\bselect|select)\b/i.test(sql) && !/\b(for\s+(update|share|no\s+key)|nextval|random\s*\(|now\s*\(|clock_timestamp|statement_timestamp|current_timestamp|pg_advisory|txid_current|current_date|current_time|localtime|insert\b|update\b|delete\b)/i.test(sql);
}
function createBridgePool({ url, secret, db = 'primary', fetcher = fetch, timeoutMs = 15_000, retries = 2, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), batchMs = 2, maxBatch = 16, cacheMs = 0 }) {
    if (!(0, exports.validSecret)(secret))
        throw new Error(`PETTO_BRIDGE_SECRET needs at least ${exports.MIN_SECRET_LENGTH} characters.`);
    if (!/^https?:\/\//i.test(url))
        throw new Error('PETTO_DB_BRIDGE_URL must be an http(s) address.');
    const stats = { requests: 0, queries: 0, batches: 0, batchedQueries: 0, cacheHits: 0, errors: 0, totalMs: 0, lastMs: 0, maxMs: 0 };
    async function post(payload) {
        const body = JSON.stringify({ db, ...payload });
        const id = (0, node_crypto_1.randomBytes)(12).toString('hex'); // the same id on every try: if the answer got lost the server gives the one it already had instead of running twice
        let lastError;
        const started = Date.now();
        stats.requests += 1;
        try {
            for (let attempt = 0; attempt <= retries; attempt += 1) {
                const timestamp = now();
                try {
                    const response = await fetcher(url, {
                        method: 'POST', signal: AbortSignal.timeout(timeoutMs), body,
                        headers: { 'Content-Type': 'application/octet-stream', 'x-bridge-time': String(timestamp), 'x-bridge-id': id, 'x-bridge-signature': (0, exports.sign)(secret, timestamp, id, body) },
                    });
                    const json = await response.json().catch(() => null);
                    if (response.status === 429 || response.status >= 502) {
                        lastError = new Error(`the bridge answered ${response.status}`);
                        await wait(200 * (attempt + 1));
                        continue;
                    }
                    if (!json)
                        throw new Error(`the bridge answered ${response.status} without a body`);
                    return json;
                }
                catch (error) {
                    lastError = error;
                    if (attempt < retries)
                        await wait(200 * (attempt + 1));
                }
            }
            stats.errors += 1;
            throw lastError instanceof Error ? lastError : new Error(String(lastError));
        }
        finally {
            const took = Date.now() - started;
            stats.totalMs += took;
            stats.lastMs = took;
            stats.maxMs = Math.max(stats.maxMs, took);
        }
    }
    const reviveResult = (result) => ({ ...result, rows: decode(result.rows) });
    let queue = [];
    let timer = null;
    async function flush() {
        const batch = queue;
        queue = [];
        timer = null;
        if (!batch.length)
            return;
        if (batch.length === 1) {
            const only = batch[0];
            try {
                const answer = await post({ op: 'query', text: only.sql, values: only.params ? only.params.map(encode) : undefined });
                if (!answer.ok)
                    only.reject(new BridgeError((answer.error ?? {})));
                else
                    only.resolve(reviveResult(answer.result));
            }
            catch (error) {
                only.reject(error);
            }
            return;
        }
        stats.batches += 1;
        stats.batchedQueries += batch.length;
        try {
            const answer = await post({ op: 'batch', items: batch.map((item) => ({ text: item.sql, values: item.params ? item.params.map(encode) : undefined })) });
            if (!answer.ok || !Array.isArray(answer.results))
                throw new BridgeError((answer.error ?? { message: 'bad batch answer' }));
            batch.forEach((item, index) => {
                const one = answer.results[index];
                if (one?.ok)
                    item.resolve(reviveResult(one.result));
                else
                    item.reject(new BridgeError(((one?.error) ?? { message: 'missing answer' })));
            });
        }
        catch (error) {
            batch.forEach((item) => item.reject(error));
        }
    }
    function enqueue(sql, params) {
        stats.queries += 1;
        return new Promise((resolve, reject) => {
            queue.push({ sql, params, resolve, reject });
            if (batchMs <= 0 || queue.length >= maxBatch) {
                if (timer)
                    clearTimeout(timer);
                void flush();
                return;
            }
            timer ??= setTimeout(() => { void flush(); }, batchMs);
        });
    }
    // ---- a few seconds of memory for plain SELECTs; any write of this instance (or an event from the primary) forgets everything ----
    const remembered = new Map();
    const keyOf = (sql, params) => `${sql}\u0000${JSON.stringify(encode(params ?? []))}`;
    const copy = (result) => ({ ...result, rows: decode(encode(result.rows)) }); // whoever gets rows may change them
    async function run(sql, params) {
        if (cacheMs > 0 && cacheable(sql)) {
            const key = keyOf(sql, params);
            const hit = remembered.get(key);
            if (hit && now() - hit.at < cacheMs) {
                stats.cacheHits += 1;
                return copy(await hit.result);
            }
            const result = enqueue(sql, params);
            remembered.set(key, { at: now(), result });
            result.catch(() => { if (remembered.get(key)?.result === result)
                remembered.delete(key); });
            if (remembered.size > 500)
                remembered.delete(remembered.keys().next().value);
            return copy(await result);
        }
        if (cacheMs > 0 && !/^\s*(select|with|show|explain)\b/i.test(sql))
            remembered.clear(); // this instance wrote: what it remembered may be wrong now
        return enqueue(sql, params);
    }
    const sqlOf = (text) => (typeof text === 'string' ? text : String(text?.text ?? ''));
    const paramsOf = (text, values) => (Array.isArray(values) ? values : text?.values);
    return {
        isBridge: true,
        db,
        totalCount: 0, idleCount: 0, waitingCount: 0,
        /** Same as `pool.query(text, values)` (the callback form is not used by Petto). */
        query: (text, values) => run(sqlOf(text), paramsOf(text, values)),
        /** A connection kept on the other side, for a transaction (BEGIN ... COMMIT). `release()` gives it back (and rolls back what was left open). Its queries are never batched or remembered. */
        async connect() {
            remembered.clear();
            const answer = await post({ op: 'connect' });
            if (!answer.ok)
                throw new BridgeError((answer.error ?? {}));
            const session = String(answer.session);
            let released = false;
            return {
                query: async (text, values) => {
                    if (released)
                        throw new Error('Client has already been released.');
                    const reply = await post({ op: 'query', text: sqlOf(text), values: paramsOf(text, values)?.map(encode), session });
                    if (!reply.ok)
                        throw new BridgeError((reply.error ?? {}));
                    return reviveResult(reply.result);
                },
                release: () => { if (released)
                    return; released = true; remembered.clear(); post({ op: 'release', session }).catch(() => { }); },
            };
        },
        /** Which databases the primary has (`primary`, and `vault`, `code`, `data2` when they are configured there). */
        async info() {
            const answer = await post({ op: 'info' });
            if (!answer.ok)
                throw new BridgeError((answer.error ?? {}));
            return answer.targets ?? [];
        },
        /** Forget what was remembered (the primary said something changed). */
        clearCache() { remembered.clear(); },
        /** For `!perf`: how the trips to the primary go. */
        stats: () => ({ ...stats, avgMs: stats.requests ? stats.totalMs / stats.requests : 0, remembered: remembered.size }),
        on() { },
        async end() { },
    };
}

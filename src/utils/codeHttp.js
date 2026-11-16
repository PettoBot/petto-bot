"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTP_LIMITS = void 0;
exports.isBlockedAddress = isBlockedAddress;
exports.checkUrl = checkUrl;
exports.cleanHeaders = cleanHeaders;
exports.httpRequest = httpRequest;
exports.resetHttpCounts = resetHttpCounts;
// i18n-ignore-file: the answers of a web page go back to the code as data (Status, Body...), they are not messages for people.
// The requests of Petto Code (httpGet and httpPost): a command written in code may ask a web page for data. It is held tight, because the
// code is written by the members of a server and the bot runs it from its own network: only https, only public addresses (never the bot's
// own network, never a private address, checked when the name is resolved and not only when it is written), no redirects, a short wait,
// a small answer, a few requests per run and a few each minute for each server.
const node_https_1 = __importDefault(require("node:https"));
const node_dns_1 = __importDefault(require("node:dns"));
const node_net_1 = __importDefault(require("node:net"));
exports.HTTP_LIMITS = { timeoutMs: 2500, maxBytes: 100_000, maxBodyChars: 5000, maxHeaders: 10, maxUrlChars: 500, perMinute: 30 };
// Every address that is not a public one on the internet.
const blocked = new node_net_1.default.BlockList();
for (const [address, bits] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
    ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
])
    blocked.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96]])
    blocked.addSubnet(address, bits, 'ipv6');
/** Whether an address is one the code may never reach (an IPv6 address that carries an IPv4 one is judged by the IPv4 one). */
function isBlockedAddress(address) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const ip = mapped ? mapped[1] : address;
    const family = node_net_1.default.isIP(ip);
    if (!family)
        return true;
    return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
/** The address as a URL, or the reason it is not allowed (`invalid`, `https`, `credentials`, `port`, `host`). */
function checkUrl(text) {
    if (typeof text !== 'string' || !text || text.length > exports.HTTP_LIMITS.maxUrlChars)
        return { problem: 'invalid' };
    let url;
    try {
        url = new URL(text.trim());
    }
    catch {
        return { problem: 'invalid' };
    }
    if (url.protocol !== 'https:')
        return { problem: 'https' };
    if (url.username || url.password)
        return { problem: 'credentials' };
    if (url.port && url.port !== '443')
        return { problem: 'port' };
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || node_net_1.default.isIP(host) || host.startsWith('[') || host === 'localhost' || !host.includes('.') || /\.(?:local|localhost|internal|lan|home|corp|intranet)$/.test(host))
        return { problem: 'host' };
    return { url };
}
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'expect', 'cookie', 'proxy-authorization', 'proxy-connection', 'keep-alive']);
/** The headers the code may send: a few, with plain names, never the ones that change how the request is made. */
function cleanHeaders(headers) {
    const clean = {};
    const entries = Object.entries(headers ?? {});
    if (entries.length > exports.HTTP_LIMITS.maxHeaders)
        return null;
    for (const [name, value] of entries) {
        if (!/^[A-Za-z0-9-]{1,40}$/.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('proxy-'))
            return null;
        if (typeof value !== 'string' || value.length > 500 || /[\r\n]/.test(value))
            return null;
        clean[name] = value;
    }
    return clean;
}
/** The name is resolved here and every address is checked, so a name that points to a private address is refused (and cannot change between the check and the connection). */
function safeLookup(hostname, options, callback) {
    const wantsAll = typeof options === 'object' && options !== null && Boolean(options.all);
    node_dns_1.default.lookup(hostname, { all: true }, (error, addresses) => {
        if (error) {
            callback(error);
            return;
        }
        if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
            callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
            return;
        }
        if (wantsAll)
            callback(null, addresses);
        else
            callback(null, addresses[0].address, addresses[0].family);
    });
}
const realTransport = (spec, url) => new Promise((resolve, reject) => {
    const body = spec.method === 'POST' ? Buffer.from(spec.body ?? '', 'utf8') : null;
    const request = node_https_1.default.request({
        protocol: 'https:', hostname: url.hostname, path: `${url.pathname}${url.search}`, method: spec.method, lookup: safeLookup, agent: false,
        headers: { 'User-Agent': 'PettoCode/1.0 (+https://petto.sbs)', Accept: 'application/json, text/plain, */*', ...(spec.headers ?? {}), ...(body ? { 'Content-Length': String(body.length) } : {}) },
        timeout: exports.HTTP_LIMITS.timeoutMs,
    }, (response) => {
        const chunks = [];
        let size = 0;
        let truncated = false;
        response.on('data', (chunk) => {
            size += chunk.length;
            if (size > exports.HTTP_LIMITS.maxBytes) {
                truncated = true;
                chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - exports.HTTP_LIMITS.maxBytes))));
                response.destroy();
                return;
            }
            chunks.push(chunk);
        });
        const done = () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks), truncated });
        response.on('end', done);
        response.on('close', done);
        response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    if (body)
        request.write(body);
    request.end();
});
const recent = new Map(); // guildId -> the times of its latest requests
/** The same requests as a map the code reads; `transport` is only for the checks. */
async function httpRequest(spec, options) {
    const failure = (error) => ({ Status: 0, OK: false, Body: '', JSON: null, ContentType: '', Location: null, Truncated: false, Error: error });
    const now = (options.now ?? Date.now)();
    const times = (recent.get(options.guildId) ?? []).filter((time) => now - time < 60_000);
    if (times.length >= exports.HTTP_LIMITS.perMinute) {
        recent.set(options.guildId, times);
        return failure('rate');
    }
    times.push(now);
    recent.set(options.guildId, times);
    const checked = checkUrl(spec.url);
    if (!('url' in checked))
        return failure('blocked');
    try {
        const answer = await (options.transport ?? realTransport)(spec, checked.url);
        const contentType = String(Array.isArray(answer.headers['content-type']) ? answer.headers['content-type'][0] : answer.headers['content-type'] ?? '').slice(0, 100);
        const body = answer.body.toString('utf8');
        let parsed = null;
        if (!answer.truncated && (/json/i.test(contentType) || /^\s*[[{]/.test(body))) {
            try {
                parsed = JSON.parse(body);
            }
            catch {
                parsed = null;
            }
        }
        const location = answer.headers.location;
        return {
            Status: answer.status, OK: answer.status >= 200 && answer.status < 300, Body: body, JSON: parsed, ContentType: contentType,
            Location: typeof location === 'string' ? location.slice(0, 500) : null, Truncated: answer.truncated, Error: null,
        };
    }
    catch (error) {
        const code = error?.code;
        return failure(code === 'EBLOCKED' ? 'blocked' : code === 'ETIMEDOUT' ? 'timeout' : 'failed');
    }
}
/** Forgets the count of requests (for the checks). */
function resetHttpCounts() { recent.clear(); }

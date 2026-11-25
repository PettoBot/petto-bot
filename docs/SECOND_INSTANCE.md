# A second instance of Petto (Docker, a VPS, shards)

Petto can run in a second place (a VPS, any machine with Docker) that holds some of the shards while the first one (Discloud, the **primary**) keeps the databases and the web API.
Discloud's PostgreSQL does not accept connections from outside, so the second instance (the **worker**) reaches everything through the primary, with two pieces that only go **out** from the worker
(the VPS needs no open port, no domain and no tunnel):

```
Discord ── shards 1.. ──> worker (Docker, VPS) ──signed SQL over HTTPS──────────────>  primary (Discloud) ──> PostgreSQL, Vault, code, data2
                                  ▲   │                                                  POST /api/bridge/db
                                  │   └──── WebSocket kept open (/api/bridge/link) ───────┤
                                  └── the dashboard requests and the Redis messages ──────┘
Discord ── shard 0    ──> primary                                    the dashboard / the API talk to the primary only
```

## What it does

- **Databases.** Everything the bot asks a database goes through one pool, so the worker has a pool of the same shape that sends its SQL, signed, to the primary (`src/db/sqlBridge.ts`). The bridge knows every database the primary has:
  the main one, the Vault (backups), the code database and the second one. The worker asks at start which ones exist (`src/db/bridgeTargets.js`), so it needs **no database URL**.
- **The dashboard and the API reach the servers of the worker.** Every route with a `:guildId` passes through the primary, which looks at the shard of the server (`(id >> 22) % shardCount`). If a connected worker holds it, the request goes through the link,
  the worker answers it with its own copy of the same routes (listening only on `127.0.0.1`), and the primary gives the answer back. If nobody holds the shard it answers `503 shard_unavailable` (or `shard_timeout` when the worker is too slow).
- **Redis.** The worker does not need Redis. What the dashboard says on `petto:*` ("this setting changed, forget the cache") reaches it through the link, and what the worker says goes to the primary and to the other workers.
- **Background jobs.** The two instances run the jobs for **their own servers**. A job of a split instance only sees the rows of its own servers (the query builder adds the condition on the shard, a raw SELECT drops the rows of other shards, and the claim of the
  scheduled code commands names the shards), so neither does the same work twice or gives up on a server it does not hold. The jobs that work on the whole bot (the probe of the services, global numbers, the purge of departed servers, Premium, alerts and cleanups of the database:
  `ONE_PER_BOT` in `src/utils/instanceRole.ts`) run only on the primary. A worker also does not register the slash commands for the whole bot, change the schema, post the Currently log or serve the public web.
- **Status.** Every instance reports the shards it holds (state, ping, servers, members) to `bot_status` every 10 seconds, so the status page shows all of them; the row of the process (`bot_host`: uptime, memory) is written by the primary only.
  Set `PETTO_CLUSTER_NAME` (for example `Miami`) and, if you want, `PETTO_CLUSTER_LOCATION` (`Florida, US`) on each instance: the status page shows them when someone points at a shard. Both are optional (40 characters at most).
- **Latency.** Every query of a worker is a trip to the primary, so two things lower it: queries made in the same moment (`PETTO_BRIDGE_BATCH_MS`, 2 ms) share one trip, and plain SELECTs are remembered for a few seconds (`PETTO_BRIDGE_CACHE_MS`, 3000 ms;
  `0` turns it off). Any write of the worker, and any dashboard message on `petto:*`, makes it forget what it remembered. The price is data up to a few seconds old on the worker. `!perf` shows the trips, the time they take, the shared trips and the answers from memory.

## Settings

**Primary** (Discloud), besides what it already has:

| Variable | What it does |
| --- | --- |
| `PETTO_BRIDGE_SECRET` | The shared secret, at least 32 random characters (`openssl rand -hex 32`). Without it the bridge and the link do not exist. |
| `DISCORD_SHARDS` / `DISCORD_SHARD_COUNT` | The shards it holds and how many there are in all, for example `0` and `2`. |
| `PETTO_CLUSTER_NAME` / `PETTO_CLUSTER_LOCATION` | Optional: the name and place of this instance, shown on the status page. |

**Worker** (`.env.worker`, never in git):

| Variable | What it does |
| --- | --- |
| `PETTO_ROLE=worker` | Marks the instance as a worker. |
| `PETTO_DB_BRIDGE_URL` | `https://<the address of the primary's web API>/api/bridge/db` (HTTPS only). The link uses the same address. |
| `PETTO_BRIDGE_SECRET` | The same secret as the primary. |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | The same bot. |
| `DISCORD_SHARDS` / `DISCORD_SHARD_COUNT` | The other shards, for example `1` and `2`. Every shard must be held by exactly one instance, and the count must be the same everywhere. |
| `PETTO_DASHBOARD_API_SECRET` | The same as the primary: the worker's copy of the routes checks it for the requests that come through the link. |
| `PETTO_CLUSTER_NAME` / `PETTO_CLUSTER_LOCATION` | Optional: the name and place of this worker, shown on the status page (for example `Miami` and `Florida, US`). |
| `PETTO_WORKER_ID` | Optional name of the worker (the host name by default). |
| `PETTO_WORKER_JOBS` | `guild` (default: the jobs of its own servers), `essential` (only the four jobs that hold the memory of the instance) or `all`. |
| `PETTO_BRIDGE_CACHE_MS`, `PETTO_BRIDGE_BATCH_MS` | See Latency. |

Run it with `docker compose -f docker-compose.worker.yml up -d --build`. The same image runs the primary if a day comes when Discloud is not the host.

## What is not covered

- **Public pages that find the server from a token** (the verification link, the appeals and forms by their link) are answered by the instance that receives them; the instance that has the server in memory is not asked. Keep those servers on the primary's shards.
- **A server whose shard nobody holds** (a worker that is down) cannot be reached from the dashboard until the worker comes back (the link reconnects by itself, waiting up to 30 seconds between tries).
- **The jobs were reviewed through the database layer, not one by one.** Reads through the query builder and raw SELECTs that return a `guild_id` are limited to the own servers by the layer; the claim of the code schedule was fixed by hand. A job that finds its servers in some other way (a stored function, a query that does not return the server) was not checked.
- **Single servers of the bot** (the support server, the Premium roles) live on one shard: the job that works on them is a `ONE_PER_BOT` job and runs on the primary, which can only act if that server is on the primary's shards.
- The data of the worker is up to a few seconds old when the cache is on (see Latency).
- The Docker image was not built in the sandbox where this was written (there was no Docker daemon): it has the same steps as the checks, but build it once before trusting it.

## Safety

Whoever has the secret can run any SQL, so keep it like the database password. Every request and every hello of a link is signed (HMAC-SHA256 over its time, its id and what it carries), a request older than a minute or with a repeated id is refused, the SQL body is limited to 2 MB,
at most 24 requests run at once, at most 8 transactions are kept open and one left open is rolled back after 30 seconds. A worker's request through the link is limited to 12 MB. Use HTTPS only (the secret is not sent, but the SQL and the data are).

## Read replica

`PETTO_READ_DATABASE_URL` (and `PETTO_READ_DATABASE_SSL`) is an optional read-only copy of the database. When it is set, the statistics (`!stats`, the dashboard charts that read through `db/statsQueries.js`) read from it; everything else keeps using the main database.
A copy can be a little behind. Petto does not copy the data and, with Discloud closed to the outside, the copy has to come from somewhere else; nothing else reads it yet.

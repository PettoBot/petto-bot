# A second instance of Petto (Docker, a VPS, shards)

Petto can run in a second place (a VPS, any machine with Docker) that holds some of the shards while the first one (Discloud, the **primary**) keeps the database.
Discloud's PostgreSQL does not accept connections from outside, so the second instance (the **worker**) sends its SQL, signed, over HTTPS to the primary,
which runs it with its own connection. Nothing in the rest of the bot changes: everything already talks to the database through one pool, and the worker has a pool with the same shape.

```
Discord ── shards 1.. ──> worker (Docker, VPS)  ──signed SQL over HTTPS──>  primary (Discloud)  ──>  PostgreSQL
Discord ── shard 0    ──> primary                                               POST /api/bridge/db
```

## Settings

**Primary** (Discloud), besides what it already has:

| Variable | What it does |
| --- | --- |
| `PETTO_BRIDGE_SECRET` | The shared secret, at least 32 random characters (`openssl rand -hex 32`). Without it the route does not exist. |
| `DISCORD_SHARDS` / `DISCORD_SHARD_COUNT` | The shards it holds and how many there are in all, for example `0` and `2`. |

**Worker** (`.env.worker`, never in git):

| Variable | What it does |
| --- | --- |
| `PETTO_ROLE=worker` | Marks the instance as a worker (see below). |
| `PETTO_DB_BRIDGE_URL` | `https://<the address of the primary's web API>/api/bridge/db` (HTTPS only). |
| `PETTO_BRIDGE_SECRET` | The same secret as the primary. |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | The same bot. |
| `DISCORD_SHARDS` / `DISCORD_SHARD_COUNT` | The other shards, for example `1` and `2`. Every shard must be held by exactly one instance. |
| `PETTO_WORKER_JOBS` | `essential` (default), `guild` or `all`: which background jobs the worker runs (below). |

Run it with `docker compose -f docker-compose.worker.yml up -d --build`.

## What a worker does and does not do

- It holds its own shards: commands, events, the buffers of activity, voice XP and the voice channel it stays in work as in the primary, for the servers of its shards.
- It does **not** serve the web API, does **not** register the slash commands for the whole bot, does **not** change the schema and does **not** post the Currently log or the bot status.
- Background jobs: with `essential` only the ones that hold the memory of the instance itself (`startActivityStatsJob`, `startVoiceXpJob`, `startCommandDataJob`, `startStayVoiceJob`) run on the worker, and **everything else is left to the primary**.
  With `guild` it also runs the jobs that work on its own servers (streaks, reminders, tickets...) but not the ones that must run once for the whole bot (`ONE_PER_BOT` in `src/utils/instanceRole.ts`).
  Those jobs were **not checked one by one** for servers the instance does not hold, so `guild` is for testing.

## Limits to know before using it

- **The dashboard and the API only see the servers of the primary's shards.** A change made in the dashboard for a server that lives on the worker's shards (a role list, a message to send) needs the instance that holds that server; there is no forwarding between instances yet.
  The first use that is safe today is a worker for servers whose configuration is done in Discord, or a worker that holds shards only for load.
- The jobs the primary runs for a server that lives on the worker find no server in its memory and do nothing for it (with `essential`, nobody runs them for it).
- Redis and the other databases (`PETTO_VAULT_DATABASE_URL`, `PETTO_CODE_DATABASE_URL`, `PETTO_DATA2_DATABASE_URL`) are not bridged: the worker uses them only if it can reach them; without them the features that need them (backups) do nothing on the worker.
- Every query makes a trip through the network, so the worker is slower than the primary for what is heavy in the database.

## Safety of the bridge

Whoever has the secret can run any SQL, so keep it like the database password. Every request is signed (HMAC-SHA256 over its time, its id and the hash of its body), a request older than a minute or with a repeated id is refused,
the body is limited to 2 MB, at most 24 requests run at once, at most 8 transactions are kept open and one left open is rolled back after 30 seconds. Use HTTPS only (the secret is not sent, but the SQL and the data are).

## Read replica

`PETTO_READ_DATABASE_URL` (and `PETTO_READ_DATABASE_SSL`) is an optional read-only copy of the database. When it is set, the statistics (`!stats`, the dashboard charts that read through `db/statsQueries.js`) read from it; everything else keeps using the main database. A copy can be a little behind. Petto does not copy the data and, with Discloud closed to the outside, the copy has to come from somewhere else; nothing else reads it yet.

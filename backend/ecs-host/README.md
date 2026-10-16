# Gomoku ECS Node adapter

This directory runs the existing `backend/worker.js` handler on a Node ECS
process. It does not modify or deploy the Cloudflare Worker. SQLite is local to
this adapter; in-memory Durable Object namespaces are process-local.

## Requirements

- Node.js 22.12 or newer (`node:sqlite` is used).
- The pinned Node `ws` dependency installed in this directory.
- A persistent writable file path supplied through `GOMOKU_DB_PATH`.

## Start

PowerShell example:

```powershell
$env:GOMOKU_DB_PATH = 'D:\data\gomoku-ecs.sqlite'
$env:GOMOKU_ECS_PORT = '3088'
Set-Location .\backend\ecs-host
npm ci --omit=dev
Set-Location ..\..
node .\backend\ecs-host\server.mjs
```

The process binds only to `127.0.0.1`; the default port is `3088`. A reverse
proxy on the same ECS host can forward API and WebSocket traffic to that
loopback address. The local health endpoint is `http://127.0.0.1:3088/healthz`
(`GET /health` is also accepted). It checks that SQLite can answer a simple
query; the Worker creates its application tables on the first applicable API
request.

Set Worker secrets through the ECS secret/environment mechanism when those
features are needed. Supported names are `GITHUB_READ_TOKEN`,
`UPDATE_TICKET_SECRET`, `UPDATE_TICKET_ENFORCED`, `TURN_KEY_ID`,
`TURN_KEY_API_TOKEN`, `PREMIUM_PAYMENT_MODE`, `PRIVATE_GAME_MODE`, and
`PRIVATE_GAME_USERNAMES`. `PRIVATE_GAME_MODE=1` is the production default.
When enabled, `PRIVATE_GAME_USERNAMES` must contain the permitted usernames as a
comma-separated runtime value. If it is missing or empty, account-backed game
access fails closed. Keep this private value in the ECS environment/drop-in;
never commit it to this repository.
Secret values must not be placed in this directory or printed in deployment
logs. GitHub Release metadata and assets are public and can be read without a
repository token; ECS must have a persistent `UPDATE_TICKET_SECRET` to issue
short-lived download tickets. TURN credentials are optional; payment mode
defaults to disabled.

The Worker has a fixed browser-origin allowlist. To serve the game from another
origin, set `GOMOKU_ALLOWED_ORIGINS` to a comma-separated list of exact,
serialized origins, for example `https://game.example.com`. Non-loopback HTTP
origins and wildcards are rejected. The adapter only maps explicitly listed
origins through the Worker allowlist, then returns the matching CORS origin to
the browser. Do not add an origin unless it is controlled by the operator.

## Storage and runtime limits

- `GOMOKU_DB_PATH` creates a new local SQLite database; it does not connect to,
  read from, or import Cloudflare production D1. The Worker initializes tables
  in this database as it does in its normal runtime.
- `GOMOKU_ROOMS` and `GOMOKU_SOCIAL` are in-memory Durable Object substitutes.
  Room and live social sockets are lost on restart. Run a single process, or
  route each room/social namespace to the same process; this adapter does not
  coordinate multiple ECS instances.
- The reverse proxy must support WebSocket upgrades and should be the only
  public ingress. Keep this process loopback-bound and use HTTPS/WSS at the
  proxy. Forwarded host/protocol headers must come only from that trusted proxy.
- The API handler and route security remain in `backend/worker.js`; this layer
  supplies D1-shaped SQLite calls, the two DO namespaces, Fetch request/response
  bridging, and HTTP/WebSocket transport only.

## Production deployment notes

- ECS is the authoritative service. Cloudflare is a standby for read-only
  requests; mutations stay pinned to ECS so a timed-out write is never replayed
  into a separate database.
- Keep database files, account allowlists, signing material, tokens, backups,
  production hostnames, and service-specific values in operator-managed storage
  outside this repository.
- Before an ECS release, take a protected database and runtime-config backup.
  After deployment, verify service health and SQLite integrity before treating
  the release as complete.
- The private account list is supplied only through
  `PRIVATE_GAME_USERNAMES` at runtime. A missing or invalid list fails closed.
- Room and social socket state is process-local. Restarting the service
  disconnects live sessions; the adapter currently expects one active process.
- ECS updates do not deploy or migrate the Cloudflare Worker or database.

# Pack.Host node agent

The daemon that actually hosts the Minecraft servers. One per machine.

The panel (Next.js on Vercel/Pages) cannot hold a long-lived process with a
loaded world in memory, so it delegates to agents like this one over an
authenticated HTTPS API.

## What it does

- Creates one Docker container per server from the `itzg/minecraft-server` and
  `itzg/minecraft-bedrock-server` images, which resolve the jar for any
  software/version pair themselves
- Enforces per-server memory and CPU caps so one server cannot starve its
  neighbours
- Runs console commands over RCON (stdin for Bedrock, which has no RCON)
- Streams container logs to the browser over a WebSocket, authenticated with a
  short-lived HMAC token minted by the panel
- Serves a path-jailed file manager, backups (`.tar.gz`), and world management
- Downloads plugins and mods straight onto the node, so a 400 MB modpack never
  passes through a serverless function
- Sleeps idle servers and reports every transition back to the panel

## Requirements

- Linux with Docker and access to `/var/run/docker.sock`
- Node 20+ (or just use the provided Dockerfile)
- A writable `DATA_DIR` on a disk with room for worlds and backups

## Run it

```bash
cp .env.example .env    # fill in NODE_ID, AGENT_SHARED_SECRET, PANEL_URL
docker compose up -d --build
docker compose logs -f
```

Or without Docker:

```bash
npm ci
node --env-file=.env src/index.js
```

## API

Every route except `/health` requires `Authorization: Bearer $AGENT_SHARED_SECRET`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness, unauthenticated |
| GET | `/capacity` | Server count and memory in use |
| POST | `/servers` | Create or reconcile a server from a spec |
| POST | `/servers/:id/start` | Start the container |
| POST | `/servers/:id/stop` | Graceful stop, or `{ "force": true }` |
| DELETE | `/servers/:id` | Remove the container and all data |
| GET | `/servers/:id/stats` | Running state, players, CPU, memory |
| GET | `/servers/:id/logs` | Recent console output |
| POST | `/servers/:id/command` | Run a console command |
| PATCH | `/servers/:id/properties` | Merge into `server.properties` |
| POST | `/servers/:id/addons` | Download a plugin/mod onto the node |
| POST | `/servers/:id/addons/toggle` | Enable/disable by renaming |
| GET/POST/DELETE | `/servers/:id/files*` | File manager |
| GET/POST/DELETE | `/servers/:id/backups*` | Backups |
| GET/POST | `/servers/:id/worlds*` | Worlds |
| WS | `/ws/console?server=&token=` | Live console stream |

`POST /servers` is idempotent: the panel sends the complete desired spec every
time, so the same call provisions a new server, applies a settings change, and
repairs one after a node rebuild.

## Security

- The shared secret is compared in constant time on every request
- Console tokens are HMAC-signed by the panel, scoped to a single server, and
  expire after 15 minutes
- Every file path is resolved and checked against the server's own directory
  before any I/O — the panel validates too, but this is the boundary that counts
- Containers get hard memory and CPU limits and no restart policy, so a crash
  loop cannot take the node down

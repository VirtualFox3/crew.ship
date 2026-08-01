# Deploying Pack.Host

Three pieces, in this order:

1. **Supabase** — accounts and data
2. **The panel** — Next.js on Vercel (or Cloudflare Pages)
3. **A node** — a Linux box running `agent/`, which is what actually hosts the
   Minecraft servers

You can stop after step 2 and get a working site with accounts; servers will
sit at "no node online" until step 3.

---

## 1. Supabase

Create a project at [supabase.com](https://supabase.com), then:

**Apply the schema.** Paste `supabase/migrations/0001_init.sql` into the SQL
Editor and run it. It creates every table, all row-level security policies, and
the trigger that gives each new signup a profile.

**Grab the keys** from Project Settings → API:

| Key | Goes in |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` |

The service role key bypasses row-level security. It is only ever read in
server-side route handlers — never ship it to the browser.

**Auth settings** (Authentication → URL Configuration):

- Site URL: your panel's URL
- Redirect URLs: add `https://<your-panel>/auth/callback`

Email confirmation is on by default. Turn it off under Authentication →
Providers → Email if you want instant signup. For the "Continue with Discord"
button, enable the Discord provider and paste in a Discord application's client
ID and secret.

---

## 2. The panel

### Vercel

```bash
npx vercel --prod
```

Or import the repository at [vercel.com/new](https://vercel.com/new). It is a
stock Next.js app — no build configuration needed.

The three public values already ship in the committed `.env.production`, so
accounts work on the first deploy with nothing configured. Only the two real
secrets need to go in Project → Settings → Environment Variables, for
Production **and** Preview:

```
SUPABASE_SERVICE_ROLE_KEY=<service role key>
AGENT_SHARED_SECRET=<openssl rand -base64 48>
```

Redeploy so they are picked up. Until they are set: the landing page, signup,
login, the dashboard and creating a server all work, but starting or managing
a server returns a clear "Missing SUPABASE_SERVICE_ROLE_KEY" error rather than
failing silently.

To point the panel at a different Supabase project, either edit
`.env.production` or set the same `NEXT_PUBLIC_*` names in the dashboard —
real environment variables take precedence over the file.

> **Deployment protection.** A new Vercel project often has Vercel
> Authentication switched on, which makes the site visible only to your team.
> For a public hosting panel, turn it off under Settings → Deployment
> Protection, or nobody can sign up.

### Cloudflare Workers

The adapter is already wired up: `open-next.config.ts`, `wrangler.jsonc` and
three `cf:*` npm scripts are committed. `nodejs_compat` is on because the panel
signs agent tokens with `node:crypto`.

**Config splits in two, and getting this backwards is the one thing that will
bite you.** `next build` inlines every `NEXT_PUBLIC_*` value into the browser
bundle, so those have to exist *at build time* — `wrangler secret put` runs too
late and the login form ends up pointed at an empty URL. The two real secrets
are read on the server at request time and must **not** be baked into a bundle.

Build-time — already handled. `.env.production` is committed with the three
public values, so `npm run cf:build` picks them up with no extra step. Edit
that file to point at a different Supabase project.

Runtime — store as encrypted secrets:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put AGENT_SHARED_SECRET
```

Then authenticate and ship:

```bash
npx wrangler login          # or export CLOUDFLARE_API_TOKEN=...
npm run cf:deploy
```

`npm run cf:preview` runs the identical bundle locally in workerd first, which
is worth doing once — it catches anything that works under Node but not on
Workers. Use `.dev.vars` (same keys, gitignored) to feed the preview.

The anon key is designed to be public and ships to browsers by design; row-level
security is what protects the data. The service role key and agent secret are
not — keep them in `wrangler secret`.

> Neither platform can run the Minecraft servers themselves — that is what the
> node in step 3 is for.

---

## 3. Bring up a node

Any Linux machine with Docker, x86 or ARM. A useful starting size is 8 vCPU /
32 GB RAM, which comfortably holds ~40 servers given that idle ones sleep.

### Free option: Oracle Cloud Always Free

Oracle's Always Free tier gives 4 ARM cores, 24 GB RAM and 200 GB of disk
indefinitely — enough for roughly 12–15 servers. It is the only free tier large
enough to be useful here; the others cap out around 1 GB of RAM.

Create an **Ampere (VM.Standard.A1.Flex)** instance with Ubuntu 22.04, 4 OCPUs
and 24 GB. Two things to know going in:

- **ARM cannot run native Bedrock.** Mojang ships the Bedrock Dedicated Server
  for x86 only. Every Java software works, and Bedrock players still get in
  through Geyser crossplay, so this costs you nothing in practice. The panel
  reads each node's architecture from its heartbeat and greys out Bedrock when
  no x86 node is online, so nobody can create a server that will not start.
- **Oracle blocks ports in two separate places.** The instance has iptables
  rules that reject everything but SSH, *and* the VCN has its own security
  lists. `install.sh` handles the first and persists the change; the second is
  in the console under Networking → Virtual Cloud Networks → your VCN →
  Security Lists. Add ingress rules for 8080/tcp, 80/tcp, 443/tcp and
  25600–25999 on **both** tcp and udp. Missing this is the single most common
  reason a node looks dead from outside while reporting healthy locally.

ARM capacity is frequently "out of capacity" in busy regions — retry, or pick a
different home region.

### Register it in the database

Run this in the Supabase SQL editor and keep the returned `id`:

```sql
insert into nodes (name, region, agent_url, public_host, max_servers, max_memory_mb,
                   port_range_start, port_range_end, status)
values ('node-1', 'eu-central', 'https://node1.example.com', 'node1.example.com',
        40, 32768, 25600, 25999, 'offline')
returning id;
```

`agent_url` is where the panel reaches the agent's control API. `public_host`
is the hostname players connect to. `status` flips to `online` on the agent's
first heartbeat.

### Install the agent

One command does the whole thing — installs Docker, sizes capacity from the
box's RAM, writes the config, opens the firewall, starts the agent, waits for
it to report healthy, then prints the exact SQL to register the node and the
Caddy snippet for TLS:

```bash
curl -fsSL https://raw.githubusercontent.com/VirtualFox3/Pack.Host/main/agent/install.sh | sudo bash
```

It generates the node's UUID locally, so you run one SQL statement at the end
rather than inserting a row first to get an id. To run it unattended:

```bash
PANEL_URL=https://packhost.vercel.app \
AGENT_SHARED_SECRET=... \
PUBLIC_HOST=node1.example.com \
  sudo -E bash agent/install.sh
```

Or do it by hand:

```bash
git clone <this repo> packhost && cd packhost/agent
cp .env.example .env
```

Fill in `.env`:

```
NODE_ID=<the uuid returned above>
NODE_NAME=node-1
AGENT_SHARED_SECRET=<exactly the same value as the panel>
PANEL_URL=https://<your-panel>
PORT_RANGE_START=25600
PORT_RANGE_END=25999
MAX_SERVERS=40
MAX_MEMORY_MB=32768
DATA_DIR=/var/lib/packhost
```

Then:

```bash
sudo mkdir -p /var/lib/packhost
docker compose up -d --build
docker compose logs -f
```

You should see a heartbeat every 20 seconds, and the node turn `online` in the
panel.

### Firewall

| Port | Protocol | Why |
|---|---|---|
| 8080 | TCP | Control API + console WebSocket (put TLS in front) |
| 25600–25999 | TCP | Java servers |
| 25600–25999 | UDP | Bedrock servers and Geyser crossplay |

### No public IP or domain? Use playit.gg

A tunnel removes the three hardest parts of node setup at once: no port
forwarding, no domain, no TLS certificate. It is what makes hosting from a home
machine or a NAT'd box possible, and it is free.

1. Sign up at [playit.gg](https://playit.gg) and copy your **secret key** from
   Account → Settings.
2. Give it to `install.sh` when prompted, or pass `PLAYIT_SECRET_KEY=...`. The
   installer starts the tunnel agent alongside the Pack.Host agent.
3. For each server, add a tunnel at
   [playit.gg/account/tunnels](https://playit.gg/account/tunnels) pointing at
   the node-local port (handed out from 25600 upward), then record the mapping:

```sql
update nodes
   set tunnel_host  = 'your-name.craft.playit.gg',
       tunnel_ports = '{"25601": 41234, "25602": 41235}'::jsonb
 where id = '<node id>';
```

**The mapping is the part that matters.** playit publishes a *different* port
than the server binds locally — a server on 25601 might be reachable at
`your-name.craft.playit.gg:41234`. Without the mapping the panel would show
25601, which nothing outside the machine can reach. With it, the panel shows
players the address that actually works.

The agent's control API still needs HTTPS separately — either the Caddy setup
below, or a Cloudflare Tunnel.

### How the panel picks an address

Four sources, most specific first, so the panel never shows an address that
does not resolve:

| Order | Source | Shown as |
|---|---|---|
| 1 | The server's custom domain | `play.example.com` |
| 2 | Node tunnel + mapped port | `abc.craft.playit.gg:41234` |
| 3 | Wildcard DNS, if `NEXT_PUBLIC_SERVER_DOMAIN` is set to a domain you own | `myserver.example.com:25601` |
| 4 | The node's own host or IP | `203.0.113.5:25601` |

If `NEXT_PUBLIC_SERVER_DOMAIN` is left at the `pack.host` placeholder it is
skipped entirely — otherwise the panel would advertise a domain you do not
control.

### TLS for the agent

The panel calls the agent over HTTPS and the browser opens a `wss://` console
socket, so the agent needs a certificate. Easiest is Caddy in front of it:

```
node1.example.com {
    reverse_proxy localhost:8080
}
```

Caddy handles the certificate and the WebSocket upgrade with no extra config.

### DNS

Point a wildcard at the node so every server gets an address:

```
*.pack.host.  A     <node public IP>
```

For a port-free Java address, add an SRV record per server (or automate it with
your DNS provider's API):

```
_minecraft._tcp.<subdomain>.pack.host.  SRV  0 0 <port> <subdomain>.pack.host.
```

Bedrock clients always need the port typed in — the panel shows it.

---

## Verifying

1. Sign up on the panel.
2. Create a server: Java → Paper → the newest version.
3. Press **Start**. Status goes `preparing` → `starting` → `online`, and the
   console streams the server's output.
4. Open **Plugins**, search for something, and install it. It appears under
   Installed and lands in `plugins/` on the node.
5. Join with the address shown on the server page.

## Operational notes

- **Idle sleep** is the reason this is affordable. The agent polls player count
  over RCON and stops a server after its configured idle window, then tells the
  panel, which promotes whoever is first in the queue.
- **Backups** are plain `.tar.gz` files under `DATA_DIR/backups/<server-id>`.
  Nothing proprietary; copy them anywhere.
- **Adding capacity** is one more `nodes` row and one more agent. The panel
  places each new server on the least-loaded node with room for it.
- **Rebuilding a node** is safe as long as `DATA_DIR` survives. The panel sends
  the full server spec on every start, so the agent recreates containers and
  re-downloads add-ons from scratch.

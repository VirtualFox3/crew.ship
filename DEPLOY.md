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

Then set the environment variables (Project → Settings → Environment
Variables), for Production **and** Preview:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
AGENT_SHARED_SECRET=<openssl rand -base64 48>
NEXT_PUBLIC_SERVER_DOMAIN=pack.host
```

Redeploy so the new variables are picked up. Until they are set, the site
serves the landing page and shows a setup notice inside the panel instead of
erroring.

### Cloudflare Pages

Pages needs the OpenNext adapter to run a Next.js app with server components:

```bash
npm i -D @opennextjs/cloudflare wrangler
npx opennextjs-cloudflare build
npx wrangler deploy
```

Set the same variables with `npx wrangler secret put <NAME>`. Everything else
is identical.

> Neither platform can run the Minecraft servers themselves — that is what the
> node in step 3 is for.

---

## 3. Bring up a node

Any Linux machine with Docker. A useful starting size is 8 vCPU / 32 GB RAM,
which comfortably holds ~40 servers given that idle ones sleep.

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

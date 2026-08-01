#!/usr/bin/env bash
#
# Pack.Host node installer.
#
# Turns a fresh Linux box into a node that hosts Minecraft servers for the
# panel. Installs Docker if needed, writes the agent config, registers the
# node, and starts everything.
#
#   curl -fsSL https://raw.githubusercontent.com/VirtualFox3/Pack.Host/main/agent/install.sh | bash
#
# or, from a clone:
#
#   sudo bash agent/install.sh
#
# Every value can be passed as an environment variable to run unattended:
#
#   PANEL_URL=https://packhost.vercel.app \
#   AGENT_SHARED_SECRET=... \
#   PUBLIC_HOST=node1.example.com \
#   sudo -E bash agent/install.sh

set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/packhost}"
PORT="${PORT:-8080}"
PORT_RANGE_START="${PORT_RANGE_START:-25600}"
PORT_RANGE_END="${PORT_RANGE_END:-25999}"
NODE_NAME="${NODE_NAME:-$(hostname -s 2>/dev/null || echo node-1)}"
REGION="${REGION:-global}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  x  %s\033[0m\n' "$*" >&2; exit 1; }

bold "Pack.Host node installer"
echo

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "Run as root (use sudo)."
[ "$(uname -s)" = "Linux" ] || die "Nodes must run on Linux; Docker needs real cgroups."

# Total RAM, minus a reserve for the host itself, is what we hand to servers.
TOTAL_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
RESERVE_MB=$(( TOTAL_MB / 5 ))
[ "$RESERVE_MB" -lt 1024 ] && RESERVE_MB=1024
MAX_MEMORY_MB="${MAX_MEMORY_MB:-$(( TOTAL_MB - RESERVE_MB ))}"
[ "$MAX_MEMORY_MB" -lt 1024 ] && die "Need at least 2 GB RAM; this box has ${TOTAL_MB} MB."

# Roughly one server per 1.5 GB, since idle servers sleep and free their slot.
MAX_SERVERS="${MAX_SERVERS:-$(( MAX_MEMORY_MB / 1536 ))}"
[ "$MAX_SERVERS" -lt 1 ] && MAX_SERVERS=1

# Architecture decides which server software this node can host. The agent
# reports it on every heartbeat and the panel greys out the rest.
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "Unsupported CPU architecture: $(uname -m). Nodes need x86_64 or arm64." ;;
esac

info "CPU architecture         : ${ARCH} ($(uname -m))"
info "RAM available to servers : ${MAX_MEMORY_MB} MB of ${TOTAL_MB} MB"
info "Server slots             : ${MAX_SERVERS}"

if [ "$ARCH" = "arm64" ]; then
  warn "ARM node: Java servers (Paper, Fabric, Forge...) all work."
  warn "Mojang ships no ARM build of the Bedrock server, so native Bedrock is"
  warn "unavailable here. Bedrock players can still join via Geyser crossplay."
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ask() {
  # ask VAR "prompt" [default] — skipped entirely when VAR is already set.
  local var="$1" prompt="$2" default="${3:-}" value
  value="${!var:-}"
  if [ -z "$value" ]; then
    [ -t 0 ] || die "$var is not set and there is no terminal to ask on. Pass it as an environment variable."
    if [ -n "$default" ]; then
      read -r -p "  $prompt [$default]: " value
      value="${value:-$default}"
    else
      read -r -p "  $prompt: " value
    fi
  fi
  [ -n "$value" ] || die "$var is required."
  printf -v "$var" '%s' "$value"
}

echo
ask PANEL_URL "Panel URL (e.g. https://packhost.vercel.app)"
ask AGENT_SHARED_SECRET "AGENT_SHARED_SECRET (must match the panel exactly)"
ask PUBLIC_HOST "Public hostname or IP players will connect to" "$(hostname -f 2>/dev/null || echo localhost)"

PANEL_URL="${PANEL_URL%/}"

# The node's identity. Generating it here rather than reading it back from the
# panel means the operator runs exactly one SQL statement, at the end.
NODE_ID="${NODE_ID:-$(cat /proc/sys/kernel/random/uuid)}"

# The agent's control API needs TLS, because the browser opens a wss:// console
# against it and a page served over https cannot talk to ws://.
AGENT_URL="${AGENT_URL:-https://${PUBLIC_HOST}}"

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

echo
if command -v docker >/dev/null 2>&1; then
  info "Docker already installed: $(docker --version)"
else
  bold "Installing Docker"
  curl -fsSL https://get.docker.com | sh || die "Docker install failed."
fi

docker info >/dev/null 2>&1 || die "Docker is installed but the daemon is not running. Try: systemctl start docker"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Docker Compose not found. Install the docker-compose-plugin package."
fi

# ---------------------------------------------------------------------------
# Source
# ---------------------------------------------------------------------------

if [ -f "$(dirname "$0")/docker-compose.yml" ]; then
  AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
  info "Using the agent source at ${AGENT_DIR}"
else
  AGENT_DIR=/opt/packhost/agent
  bold "Fetching the agent source"
  command -v git >/dev/null 2>&1 || die "git is required when piping this script from the web."
  if [ -d /opt/packhost/.git ]; then
    git -C /opt/packhost pull --ff-only
  else
    rm -rf /opt/packhost
    git clone --depth 1 https://github.com/VirtualFox3/Pack.Host.git /opt/packhost
  fi
fi

# ---------------------------------------------------------------------------
# Write config
# ---------------------------------------------------------------------------

mkdir -p "$DATA_DIR"

umask 077
cat > "${AGENT_DIR}/.env" <<EOF
# Written by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_ID=${NODE_ID}
NODE_NAME=${NODE_NAME}
AGENT_SHARED_SECRET=${AGENT_SHARED_SECRET}
PANEL_URL=${PANEL_URL}

PORT=${PORT}
PORT_RANGE_START=${PORT_RANGE_START}
PORT_RANGE_END=${PORT_RANGE_END}

MAX_SERVERS=${MAX_SERVERS}
MAX_MEMORY_MB=${MAX_MEMORY_MB}

DATA_DIR=${DATA_DIR}
EOF
umask 022

info "Wrote ${AGENT_DIR}/.env (chmod 600)"

# ---------------------------------------------------------------------------
# Firewall
# ---------------------------------------------------------------------------

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  bold "Opening firewall ports"
  ufw allow "${PORT}/tcp"  >/dev/null 2>&1 || true
  ufw allow 80/tcp         >/dev/null 2>&1 || true
  ufw allow 443/tcp        >/dev/null 2>&1 || true
  ufw allow "${PORT_RANGE_START}:${PORT_RANGE_END}/tcp" >/dev/null 2>&1 || true
  ufw allow "${PORT_RANGE_START}:${PORT_RANGE_END}/udp" >/dev/null 2>&1 || true
  info "Opened ${PORT}, 80, 443 and ${PORT_RANGE_START}-${PORT_RANGE_END} (tcp+udp)"
else
  warn "No active ufw firewall detected — make sure these are reachable:"
  warn "  ${PORT}/tcp, and ${PORT_RANGE_START}-${PORT_RANGE_END} on BOTH tcp and udp"
fi

# Oracle Cloud images ship an iptables REJECT rule that drops everything except
# SSH, and it survives reboots via netfilter-persistent. It is the single most
# common reason an Oracle node looks dead from the outside while the agent
# reports perfectly healthy locally.
if [ -d /etc/iptables ] || (command -v iptables >/dev/null 2>&1 && iptables -S INPUT 2>/dev/null | grep -q "REJECT"); then
  bold "Oracle-style iptables rules detected — opening ports there too"
  iptables -I INPUT -p tcp --dport "${PORT}" -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport "${PORT_RANGE_START}:${PORT_RANGE_END}" -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p udp --dport "${PORT_RANGE_START}:${PORT_RANGE_END}" -j ACCEPT 2>/dev/null || true

  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null 2>&1 || true
    info "Saved iptables rules so they survive a reboot"
  else
    warn "Could not persist iptables rules — they will be lost on reboot."
    warn "Install iptables-persistent to keep them."
  fi

  warn "Oracle blocks ports in TWO places. The instance firewall is now open,"
  warn "but you must ALSO allow them in the Cloud console:"
  warn "  Networking > Virtual Cloud Networks > your VCN > Security Lists"
  warn "  Add ingress rules for ${PORT}/tcp, 80/tcp, 443/tcp,"
  warn "  and ${PORT_RANGE_START}-${PORT_RANGE_END} on both tcp and udp."
fi

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

echo
bold "Starting the agent"
cd "$AGENT_DIR"
$COMPOSE up -d --build

echo
info "Waiting for the agent to answer..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "${HEALTHY:-0}" = "1" ]; then
  info "Agent is healthy: $(curl -fsS "http://127.0.0.1:${PORT}/health")"
else
  warn "Agent did not become healthy in 60s. Check: $COMPOSE logs -f"
fi

# ---------------------------------------------------------------------------
# What is left for the operator
# ---------------------------------------------------------------------------

cat <<EOF

$(bold "Almost done — two steps left")

1. Register this node. Run in the Supabase SQL editor:

   insert into nodes (id, name, region, arch, agent_url, public_host,
                      max_servers, max_memory_mb,
                      port_range_start, port_range_end, status)
   values ('${NODE_ID}', '${NODE_NAME}', '${REGION}', '${ARCH}',
           '${AGENT_URL}', '${PUBLIC_HOST}',
           ${MAX_SERVERS}, ${MAX_MEMORY_MB},
           ${PORT_RANGE_START}, ${PORT_RANGE_END}, 'offline');

   The status flips to 'online' by itself within 20 seconds — the agent
   heartbeats and the panel marks it live.

2. Put TLS in front of the agent. The panel calls it over https and the
   browser opens a wss:// console, so plain http will not work:

   apt install -y caddy
   echo '${PUBLIC_HOST} {
       reverse_proxy localhost:${PORT}
   }' > /etc/caddy/Caddyfile
   systemctl reload caddy

   Caddy gets the certificate and handles the WebSocket upgrade on its own.

$(bold "Then")

   Create a server in the panel and press Start. Watch it here with:
     cd ${AGENT_DIR} && $COMPOSE logs -f

   Node id : ${NODE_ID}
   Arch    : ${ARCH}
   Data    : ${DATA_DIR}

EOF

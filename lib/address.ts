import type { Node, Server } from "@/lib/types";

/**
 * Works out the address a player actually types in.
 *
 * There are four ways a server can be reachable and they are not
 * interchangeable, so this resolves them in order of how specific they are.
 * Getting it wrong is worse than showing nothing: an address that looks real
 * but does not resolve sends people hunting for a problem on their end.
 */

export interface ResolvedAddress {
  java: string | null;
  bedrock: string | null;
  /** How it was derived, so the UI can explain itself. */
  via: "custom-domain" | "tunnel" | "wildcard" | "node-host" | "unassigned";
}

/**
 * The default in .env.example. If it is still set, the operator has not
 * configured DNS, so `<name>.howl.host` would be a dead address.
 */
const PLACEHOLDER_DOMAIN = "howl.host";

function join(host: string, port: number | null, hideDefault = false): string {
  if (!port || (hideDefault && port === 25565)) return host;
  return `${host}:${port}`;
}

/** Relay port for a node-local port, when the node is behind a tunnel. */
function relayPort(node: Pick<Node, "tunnel_ports">, local: number | null): number | null {
  if (!local) return null;
  const mapped = (node.tunnel_ports as Record<string, number> | null)?.[String(local)];
  return typeof mapped === "number" ? mapped : null;
}

export function resolveAddress(
  server: Pick<
    Server,
    "subdomain" | "custom_domain" | "java_port" | "bedrock_port" | "edition"
  >,
  node: Pick<Node, "public_host" | "tunnel_host" | "tunnel_ports"> | null,
  wildcardDomain: string,
): ResolvedAddress {
  const wantsJava = server.edition !== "bedrock";
  const wantsBedrock = server.edition !== "java" && Boolean(server.bedrock_port);

  // 1. An explicit custom domain always wins — the operator pointed it here.
  if (server.custom_domain) {
    return {
      java: wantsJava ? join(server.custom_domain, server.java_port, true) : null,
      bedrock: wantsBedrock ? join(server.custom_domain, server.bedrock_port) : null,
      via: "custom-domain",
    };
  }

  // 2. Behind a tunnel the relay decides the port, so the local one is wrong.
  if (node?.tunnel_host) {
    const java = relayPort(node, server.java_port);
    const bedrock = relayPort(node, server.bedrock_port);
    // Only trust the tunnel if it actually published the port we need.
    if ((wantsJava && java) || (wantsBedrock && bedrock)) {
      return {
        java: wantsJava && java ? join(node.tunnel_host, java) : null,
        bedrock: wantsBedrock && bedrock ? join(node.tunnel_host, bedrock) : null,
        via: "tunnel",
      };
    }
  }

  // 3. Wildcard DNS, but only if the operator actually configured a domain.
  if (wildcardDomain && wildcardDomain !== PLACEHOLDER_DOMAIN) {
    const host = `${server.subdomain}.${wildcardDomain}`;
    return {
      java: wantsJava ? join(host, server.java_port, true) : null,
      bedrock: wantsBedrock ? join(host, server.bedrock_port) : null,
      via: "wildcard",
    };
  }

  // 4. Straight to the node. Ugly, but it is the one that always works.
  if (node?.public_host) {
    return {
      java: wantsJava ? join(node.public_host, server.java_port) : null,
      bedrock: wantsBedrock ? join(node.public_host, server.bedrock_port) : null,
      via: "node-host",
    };
  }

  // Not placed on a node yet — it has no address to give.
  return { java: null, bedrock: null, via: "unassigned" };
}

export const ADDRESS_HINT: Record<ResolvedAddress["via"], string | null> = {
  "custom-domain": null,
  tunnel: "Routed through a tunnel, so the port differs from the server's own.",
  wildcard: null,
  "node-host":
    "No domain configured, so this is the node's own address. Set NEXT_PUBLIC_SERVER_DOMAIN and wildcard DNS for a prettier one.",
  unassigned: "Start the server once to get an address.",
};

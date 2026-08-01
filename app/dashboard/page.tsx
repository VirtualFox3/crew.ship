import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { ServerList } from "@/components/server-list";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentConfigured } from "@/lib/agent";
import { serverDomain } from "@/lib/env";
import type { Node, Profile, Server } from "@/lib/types";
import type { NodeAddressInfo } from "@/components/server-list";

export const metadata: Metadata = { title: "Your servers" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: servers }, { data: profile }] = await Promise.all([
    supabase.from("servers").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);

  const list = (servers as Server[] | null) ?? [];
  const limit = (profile as Profile | null)?.server_limit ?? 4;

  // Addresses depend on the node: a tunnelled node publishes a different port
  // than the one the server binds locally. Node rows are service-role only.
  let nodes: Record<string, NodeAddressInfo> = {};
  try {
    const { data } = await createAdminClient()
      .from("nodes")
      .select("id, public_host, tunnel_host, tunnel_ports");
    nodes = Object.fromEntries(
      (data ?? []).map((n) => [
        n.id,
        {
          public_host: n.public_host,
          tunnel_host: n.tunnel_host,
          tunnel_ports: n.tunnel_ports ?? {},
        },
      ]),
    );
  } catch {
    // No service-role key configured; addresses fall back to the domain.
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your servers</h1>
          <p className="mt-1 text-sm text-ink-400">
            {list.length} of {limit} used · every feature included, nothing to upgrade
          </p>
        </div>
      </div>

      <FleetNotice />

      <ServerList initialServers={list} domain={serverDomain()} nodes={nodes} />
    </div>
  );
}

/**
 * Servers need a node with the Pack.Host agent on it. Surfacing that up front
 * beats letting someone create a server that can never start.
 */
async function FleetNotice() {
  if (!agentConfigured()) {
    return (
      <Alert tone="warn" title="No node connected">
        The panel is running but no machine is registered to actually host Minecraft
        servers yet. You can create and configure servers now; they will start once a
        node is online. See <code>DEPLOY.md</code> → &ldquo;Bring up a node&rdquo;.
      </Alert>
    );
  }

  let nodes: Node[] = [];
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("nodes").select("*");
    nodes = (data as Node[] | null) ?? [];
  } catch {
    return null;
  }

  const online = nodes.filter((n) => n.status === "online");
  if (!online.length) {
    return (
      <Alert tone="warn" title="No node online">
        {nodes.length
          ? "Every registered node is offline. Servers will queue until one checks back in."
          : "No node has registered yet. Follow DEPLOY.md to bring one up."}
      </Alert>
    );
  }

  const free = online.reduce((sum, n) => sum + (n.max_memory_mb - n.used_memory_mb), 0);
  if (free < 2048) {
    return (
      <Alert tone="info" title="The fleet is busy">
        New servers will join the queue and start automatically as slots free up. Queue
        position is strictly first-come — there is no way to pay past anyone.
      </Alert>
    );
  }

  return null;
}

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ServerHeader } from "@/components/server-header";
import { ServerNav } from "@/components/server-nav";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured, serverDomain } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { softwareInfo } from "@/lib/software";
import { resolveAddress } from "@/lib/address";
import type { Node, Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!isConfigured()) return { title: "Server" };
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("servers").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Server" };
}

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  if (!isConfigured()) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: server }, { data: profile }] = await Promise.all([
    supabase.from("servers").select("*").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("username, avatar_url").eq("id", user.id).maybeSingle(),
  ]);

  if (!server) notFound();

  // The node decides the address, so this is more than cosmetic — but a
  // failure here still must not take the page down.
  let node:
    | Pick<Node, "name" | "public_host" | "tunnel_host" | "tunnel_ports">
    | null = null;
  if (server.node_id) {
    try {
      const { data } = await createAdminClient()
        .from("nodes")
        .select("name, public_host, tunnel_host, tunnel_ports")
        .eq("id", server.node_id)
        .maybeSingle();
      node = data ? { ...data, tunnel_ports: data.tunnel_ports ?? {} } : null;
    } catch {
      node = null;
    }
  }

  const info = softwareInfo((server as Server).software);

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <ServerHeader
          initialServer={server as Server}
          address={resolveAddress(server as Server, node, serverDomain())}
          nodeName={node?.name ?? null}
        />

        <div className="grid gap-6 lg:grid-cols-[196px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <ServerNav
              serverId={id}
              supportsPlugins={info.supports.plugins}
              supportsMods={info.supports.mods}
            />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}

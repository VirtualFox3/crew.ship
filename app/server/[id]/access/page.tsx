import { notFound, redirect } from "next/navigation";
import { AccessManager } from "@/components/access-manager";
import { createClient } from "@/lib/supabase/server";
import type { Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: server } = await supabase.from("servers").select("*").eq("id", id).maybeSingle();
  if (!server) notFound();
  const s = server as Server;

  const [{ data: members }, { data: owner }] = await Promise.all([
    supabase
      .from("server_access")
      .select("user_id, role, permissions, created_at, profiles:user_id (username, display_name, avatar_url)")
      .eq("server_id", id),
    supabase.from("profiles").select("username").eq("id", s.owner_id).maybeSingle(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Access</h2>
        <p className="mt-1 text-sm text-ink-400">
          Invite your crew to manage the server without handing over your password.
        </p>
      </div>
      <AccessManager
        serverId={id}
        // The joined profile arrives as an array from PostgREST; normalise it.
        initialMembers={(members ?? []).map((m) => ({
          ...m,
          profiles: Array.isArray(m.profiles) ? (m.profiles[0] ?? null) : m.profiles,
        }))}
        ownerName={owner?.username ?? "owner"}
        isOwner={s.owner_id === user.id}
      />
    </div>
  );
}

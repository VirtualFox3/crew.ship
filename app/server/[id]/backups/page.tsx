import { notFound } from "next/navigation";
import { BackupManager } from "@/components/backup-manager";
import { createClient } from "@/lib/supabase/server";
import type { Backup, Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BackupsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: server }, { data: backups }] = await Promise.all([
    supabase.from("servers").select("status").eq("id", id).maybeSingle(),
    supabase
      .from("backups")
      .select("*")
      .eq("server_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!server) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Backups</h2>
        <p className="mt-1 text-sm text-ink-400">
          Your world is yours. Snapshot it any time, restore with one click.
        </p>
      </div>
      <BackupManager
        serverId={id}
        initialBackups={(backups as Backup[]) ?? []}
        offline={(server as Server).status === "offline"}
      />
    </div>
  );
}

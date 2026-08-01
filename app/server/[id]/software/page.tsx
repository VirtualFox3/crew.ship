import { notFound } from "next/navigation";
import { SoftwareSwitcher } from "@/components/software-switcher";
import { createClient } from "@/lib/supabase/server";
import type { Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SoftwarePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: server } = await supabase.from("servers").select("*").eq("id", id).maybeSingle();
  if (!server) notFound();
  const s = server as Server;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Software &amp; version</h2>
        <p className="mt-1 text-sm text-ink-400">
          Change either at any time. Nothing is locked to the plan you started on.
        </p>
      </div>
      <SoftwareSwitcher
        serverId={id}
        edition={s.edition}
        currentSoftware={s.software}
        currentVersion={s.version}
        online={s.status === "online"}
      />
    </div>
  );
}

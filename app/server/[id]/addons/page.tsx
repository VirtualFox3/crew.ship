import { notFound } from "next/navigation";
import { Alert } from "@/components/ui";
import { AddonBrowser } from "@/components/addon-browser";
import { createClient } from "@/lib/supabase/server";
import { loaderFor, softwareInfo } from "@/lib/software";
import type { Server, ServerAddon } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AddonsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: server }, { data: addons }] = await Promise.all([
    supabase.from("servers").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("server_addons")
      .select("*")
      .eq("server_id", id)
      .order("installed_at", { ascending: false }),
  ]);

  if (!server) notFound();
  const s = server as Server;
  const info = softwareInfo(s.software);

  if (!info.supports.plugins && !info.supports.mods) {
    return (
      <Alert tone="info" title={`${info.name} does not load plugins or mods`}>
        Vanilla only accepts datapacks. Switch to Paper or Purpur for plugins, or Fabric,
        Forge, NeoForge or Quilt for mods — your world comes with you.
      </Alert>
    );
  }

  const kind = info.supports.mods ? "mod" : "plugin";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          {kind === "mod" ? "Mods" : "Plugins"}
        </h2>
        <p className="mt-1 text-sm text-ink-400">
          Search Modrinth{kind === "plugin" && ", Hangar and SpigotMC"} and install with one
          click. Required dependencies are pulled in automatically.
        </p>
      </div>

      <AddonBrowser
        serverId={id}
        kind={kind}
        loader={loaderFor(s.software)}
        gameVersion={s.version}
        initialInstalled={(addons as ServerAddon[]) ?? []}
        serverOnline={s.status === "online"}
      />
    </div>
  );
}

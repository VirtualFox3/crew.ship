import { notFound, redirect } from "next/navigation";
import { OptionsForm } from "@/components/options-form";
import { createClient } from "@/lib/supabase/server";
import { softwareInfo } from "@/lib/software";
import type { Server } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OptionsPage({
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Options</h2>
        <p className="mt-1 text-sm text-ink-400">
          Everything in server.properties, plus the knobs Howl.Host adds on top.
        </p>
      </div>
      <OptionsForm
        server={s}
        canCrossplay={softwareInfo(s.software).supports.crossplay}
        isOwner={s.owner_id === user.id}
      />
    </div>
  );
}

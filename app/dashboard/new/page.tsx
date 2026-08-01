import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateServer } from "@/components/create-server";
import { createClient } from "@/lib/supabase/server";
import { serverDomain } from "@/lib/env";
import { slugify } from "@/lib/utils";

export const metadata: Metadata = { title: "New server" };
export const dynamic = "force-dynamic";

export default async function NewServerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  // Seed the address field with something unlikely to collide.
  const suggested = `${slugify(profile?.username ?? "player")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create a server</h1>
        <p className="mt-1 text-sm text-ink-400">
          Four steps. No card, no ads, no upgrade prompt at the end.
        </p>
      </div>
      <CreateServer domain={serverDomain()} suggested={suggested} />
    </div>
  );
}

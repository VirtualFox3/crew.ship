import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleDollarSign, Mail, Server as ServerIcon, Shield } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, CardHeader, Stat } from "@/components/ui";
import { SetupNotice } from "@/components/setup-notice";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!isConfigured()) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { count: serverCount }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("servers").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
  ]);

  const p = profile as Profile | null;

  return (
    <AppShell profile={p}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="mt-1 text-sm text-ink-400">
            One tier, everything unlocked.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Plan"
            value={
              <span className="flex items-center gap-2">
                <CircleDollarSign className="size-4 text-grass-400" />
                Free
              </span>
            }
            sub="forever, no ads"
          />
          <Stat
            label="Servers"
            value={
              <span className="flex items-center gap-2">
                <ServerIcon className="size-4 text-grass-400" />
                {serverCount ?? 0} / {p?.server_limit ?? 4}
              </span>
            }
            sub="fair-use ceiling"
          />
          <Stat
            label="Member since"
            value={p ? new Date(p.created_at).toLocaleDateString() : "—"}
          />
        </div>

        <Card>
          <CardHeader title="Profile" />
          <dl className="divide-y divide-ink-800">
            <Row label="Username" value={p?.username ?? "—"} />
            <Row
              label="Email"
              value={
                <span className="flex items-center gap-2">
                  <Mail className="size-3.5 text-ink-500" />
                  {user.email}
                </span>
              }
            />
            <Row
              label="Sign-in method"
              value={
                <Badge tone="grass">
                  {user.app_metadata?.provider === "email"
                    ? "Email + password"
                    : (user.app_metadata?.provider ?? "email")}
                </Badge>
              }
            />
            <Row label="Timezone" value={p?.timezone ?? "UTC"} />
          </dl>
        </Card>

        <Alert tone="info" title="What we store">
          Your email, a username, and the servers you create. No analytics, no advertising
          identifiers, no third-party trackers — the panel has none to sell.
        </Alert>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Shield className="size-4 text-ink-400" />
                Security
              </span>
            }
            description="Sessions are managed by Supabase Auth. Sign out from the header to end this one everywhere it is used."
          />
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="text-sm text-ink-400">{label}</dt>
      <dd className="text-sm font-medium text-ink-100">{value}</dd>
    </div>
  );
}

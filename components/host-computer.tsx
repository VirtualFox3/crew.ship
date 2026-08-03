import Link from "next/link";
import { Download, HardDrive, Laptop, ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import type { Node } from "@/lib/types";

export function HostComputer({ initialNodes }: { initialNodes: Node[] }) {
  return (
    <Card id="host-computer">
      <CardHeader
        title="Howl.Host Desktop"
        description="The native app runs your servers on this computer—no agent URL or Cloudflare tunnel required."
        action={<Badge tone="grass">Windows</Badge>}
      />
      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact icon={<Laptop className="size-4" />} title="Runs locally" body="Minecraft uses your CPU, memory, and disk." />
          <Fact icon={<HardDrive className="size-4" />} title="You own the files" body="Worlds and mods stay on your machine." />
          <Fact icon={<ShieldCheck className="size-4" />} title="No raw setup" body="playit.gg runs quietly beside the server." />
        </div>

        {initialNodes.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-500">Connected computers</p>
            {initialNodes.map((node) => (
              <div key={node.id} className="flex items-center justify-between border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm">
                <span>{node.name}</span>
                <Badge tone={node.status === "online" ? "grass" : "amber"}>{node.status}</Badge>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-700 pt-5">
          <p className="max-w-lg text-xs leading-relaxed text-ink-400">
            Install the app, create a Fabric server, and start it without opening Java or configuring a public control URL.
          </p>
          <Link href="/download" className="inline-flex h-10 items-center gap-2 bg-grass-500 px-4 font-mono text-xs font-semibold uppercase tracking-wider text-ink-950 hover:bg-grass-400">
            <Download className="size-4" /> Download desktop
          </Link>
        </div>
      </div>
    </Card>
  );
}

function Fact({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="border border-ink-700 bg-ink-850 p-3">
      <div className="flex items-center gap-2 text-grass-400">{icon}<strong className="text-xs text-ink-100">{title}</strong></div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{body}</p>
    </div>
  );
}

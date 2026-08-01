import Link from "next/link";
import {
  ArrowRight,
  Blocks,
  CircleDollarSign,
  Cpu,
  Gamepad2,
  Globe2,
  HardDrive,
  Layers,
  Puzzle,
  Server,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
  Users,
  Zap,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { SOFTWARE } from "@/lib/software";
import { getUser } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Puzzle,
    title: "Unlimited plugins",
    body: "Install as many plugins as your server can load. Search Modrinth, Hangar and SpigotMC from inside the panel and one-click install — dependencies included.",
  },
  {
    icon: Blocks,
    title: "Full mod support",
    body: "Fabric, Forge, NeoForge and Quilt. Install individual mods or drop in a whole modpack; we resolve the loader and the Minecraft version for you.",
  },
  {
    icon: Smartphone,
    title: "Java + Bedrock",
    body: "Run a native Bedrock server, a Java server, or flip on crossplay and let phone, console and PC players join the same world through Geyser.",
  },
  {
    icon: Layers,
    title: "Every version",
    body: "From 1.7.10 to the snapshot that dropped this morning. Version lists come live from Mojang, PaperMC, Fabric and NeoForge — never a hand-picked shortlist.",
  },
  {
    icon: Users,
    title: "Room for a crowd",
    body: "Up to 1000 player slots and 16 GB of RAM per server, on Paper, Purpur, Pufferfish or Folia for the multithreading.",
  },
  {
    icon: TerminalSquare,
    title: "Real console + files",
    body: "Live streaming console with command history, a full file manager with a code editor, scheduled backups and one-click restore.",
  },
];

const COMPARISON = [
  { label: "Price", pack: "Free", others: "Free with limits" },
  { label: "Ads", pack: "None, anywhere", others: "Interstitials + video" },
  { label: "Plugins", pack: "Unlimited", others: "Capped per server" },
  { label: "Mods", pack: "Fabric, Forge, NeoForge, Quilt", others: "Selected packs" },
  { label: "Bedrock", pack: "Native + Java crossplay", others: "Java only" },
  { label: "RAM", pack: "Up to 16 GB", others: "Fixed, low" },
  { label: "Players", pack: "Up to 1000 slots", others: "~20 slots" },
  { label: "Queue", pack: "Fair, position shown", others: "Skippable for money" },
];

export default async function LandingPage() {
  const user = isConfigured() ? await getUser() : null;

  return (
    <div className="relative overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-grass-500 text-ink-950">
              <Server className="size-4.5" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              Pack<span className="text-grass-400">.Host</span>
            </span>
          </Link>

          <div className="hidden items-center gap-7 text-sm text-ink-300 md:flex">
            <a href="#features" className="hover:text-ink-100">Features</a>
            <a href="#software" className="hover:text-ink-100">Software</a>
            <a href="#compare" className="hover:text-ink-100">Compare</a>
            <a href="#faq" className="hover:text-ink-100">FAQ</a>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <Link href="/dashboard">
                <Button size="sm">Open panel</Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button size="sm" variant="ghost">Log in</Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm">Create account</Button>
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(70%_50%_at_50%_0%,#000,transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] glow-grass" />

        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 text-center sm:pt-28">
          <Badge tone="grass" className="mx-auto mb-6 px-3 py-1 text-xs">
            <CircleDollarSign className="size-3.5" />
            Free forever · No ads · No credit card
          </Badge>

          <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
            Minecraft servers that don&apos;t{" "}
            <span className="text-grass-400">make you pay to play</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-300 sm:text-lg">
            Unlimited plugins and mods. Java and Bedrock in the same world. Every version
            Mojang ever shipped. Up to 1000 players. All of it free, and you will never see
            an advertisement here.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href={user ? "/dashboard/new" : "/signup"}>
              <Button size="lg">
                {user ? "Create a server" : "Start free — 60 seconds"}
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline">See everything included</Button>
            </a>
          </div>

          <dl className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "Plugins", v: "Unlimited", icon: Puzzle },
              { k: "Max RAM", v: "16 GB", icon: Cpu },
              { k: "Player slots", v: "1000", icon: Users },
              { k: "Storage", v: "20 GB", icon: HardDrive },
            ].map(({ k, v, icon: Icon }) => (
              <div
                key={k}
                className="rounded-xl border border-ink-700/70 bg-ink-900/60 px-4 py-3 backdrop-blur"
              >
                <Icon className="mx-auto mb-1.5 size-4 text-grass-400" />
                <dd className="text-lg font-semibold">{v}</dd>
                <dt className="text-xs text-ink-400">{k}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything the paid panels gate
          </h2>
          <p className="mt-3 text-ink-400">
            Pack.Host ships the whole control panel to everyone. There is no upgrade
            button, because there is nothing above this tier.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="p-5">
              <div className="mb-3 grid size-9 place-items-center rounded-lg bg-grass-500/12 text-grass-400">
                <Icon className="size-4.5" />
              </div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Software grid */}
      <section id="software" className="border-y border-ink-800/70 bg-ink-900/30">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {SOFTWARE.length} server softwares, one click
            </h2>
            <p className="mt-3 text-ink-400">
              Switch software or Minecraft version whenever you like. Your world, plugins
              and settings stay where they are.
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SOFTWARE.map((s) => (
              <Card key={s.id} className="flex flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{s.name}</h3>
                  <Badge tone={s.edition === "bedrock" ? "violet" : s.proxy ? "blue" : "grass"}>
                    {s.edition === "bedrock" ? "Bedrock" : s.proxy ? "Proxy" : "Java"}
                  </Badge>
                </div>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-400">{s.blurb}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.supports.plugins && <Badge>Plugins</Badge>}
                  {s.supports.mods && <Badge>Mods</Badge>}
                  {s.supports.datapacks && <Badge>Datapacks</Badge>}
                  {s.supports.crossplay && <Badge tone="violet">Crossplay</Badge>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section id="compare" className="mx-auto max-w-4xl px-5 py-20">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          How we compare
        </h2>
        <p className="mt-3 max-w-xl text-ink-400">
          The free hosts you already know fund themselves with advertising and upsells.
          We fund ourselves by keeping the fleet small and the software efficient.
        </p>

        <Card className="mt-8 overflow-hidden">
          <div className="grid grid-cols-3 border-b border-ink-700/70 bg-ink-850/60 px-5 py-3 text-xs font-medium">
            <span className="text-ink-400">Feature</span>
            <span className="text-grass-400">Pack.Host</span>
            <span className="text-ink-400">Typical free host</span>
          </div>
          {COMPARISON.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-3 items-center px-5 py-3 text-[13px] ${
                i % 2 ? "bg-ink-900/40" : ""
              }`}
            >
              <span className="text-ink-300">{row.label}</span>
              <span className="font-medium text-grass-300">{row.pack}</span>
              <span className="text-ink-500">{row.others}</span>
            </div>
          ))}
        </Card>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-ink-800/70 bg-ink-900/30">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <h2 className="text-3xl font-bold tracking-tight">Questions</h2>
          <div className="mt-8 space-y-3">
            {[
              {
                q: "How is it free with no ads?",
                a: "Servers sleep when the last player leaves, so a node runs many more servers than it has RAM for. That efficiency is the entire business model — no advertising, no priority queue you can buy, no plugin paywall.",
              },
              {
                q: "Is there really no plugin limit?",
                a: "Correct. Install every plugin your RAM can hold. The panel searches Modrinth, Hangar and SpigotMC and installs required dependencies automatically.",
              },
              {
                q: "Can Bedrock and Java players play together?",
                a: "Yes. Pick any Paper-family or Fabric software and turn on crossplay — Geyser and Floodgate are installed and configured for you, and your server gets a Bedrock port alongside the Java one.",
              },
              {
                q: "Which versions can I run?",
                a: "All of them. Release, snapshot, pre-release and April Fools versions are pulled live from Mojang's manifest, and modded versions come from the loaders' own APIs.",
              },
              {
                q: "Do I keep my world?",
                a: "Always. Download a full backup any time, upload an existing world, or restore a snapshot with one click. Nothing is locked in.",
              },
              {
                q: "What is the queue?",
                a: "When every node is full, new servers wait in line and you can see your exact position. It is strictly first-come — there is no way to pay past anyone.",
              },
            ].map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-xl border border-ink-700/70 bg-ink-900/60 px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium">
                  {q}
                  <ArrowRight className="size-4 shrink-0 text-ink-500 transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-5 py-24 text-center">
        <Gamepad2 className="mx-auto size-8 text-grass-400" />
        <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
          Your server is one click away
        </h2>
        <p className="mx-auto mt-3 max-w-md text-ink-400">
          Make an account, pick a version, and share the address. That is the whole flow.
        </p>
        <Link href={user ? "/dashboard/new" : "/signup"} className="mt-8 inline-block">
          <Button size="lg">
            {user ? "Create a server" : "Create your free account"}
            <ArrowRight className="size-4" />
          </Button>
        </Link>
      </section>

      <footer className="border-t border-ink-800/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-xs text-ink-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <Server className="size-3.5 text-grass-500" />
            <span>Pack.Host — free Minecraft hosting, no ads.</span>
          </div>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" /> No tracking
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="size-3.5" /> Sleeps when idle
            </span>
            <span className="flex items-center gap-1.5">
              <Globe2 className="size-3.5" /> Not affiliated with Mojang
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

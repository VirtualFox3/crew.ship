import Link from "next/link";
import { Slab, SlabMark } from "@/components/slab";
import { SOFTWARE } from "@/lib/software";
import { getUser } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const NAV = [
  { label: "HOME", href: "/", flex: "0.9", active: true },
  { label: "FEATURES", href: "#features", flex: "1.1" },
  { label: "MODPACKS", href: "#software", flex: "1.25" },
  { label: "COMMUNITY", href: "#faq", flex: "1.25" },
  { label: "STAFF", href: "#faq", flex: "0.75" },
];

const FEATURES = [
  {
    title: "UNLIMITED PLUGINS",
    body: "Search Modrinth, Hangar and SpigotMC from inside the panel. One-click install, dependencies resolved. No cap, ever.",
  },
  {
    title: "FULL MOD SUPPORT",
    body: "Fabric, Forge, NeoForge and Quilt. Individual mods or a whole modpack — the loader and version are worked out for you.",
  },
  {
    title: "JAVA + BEDROCK",
    body: "Run either, or flip on crossplay and let phone, console and PC players share one world through Geyser.",
  },
  {
    title: "EVERY VERSION",
    body: "1.7.10 to this morning's snapshot. Pulled live from Mojang, PaperMC, Fabric and NeoForge — never a shortlist.",
  },
  {
    title: "ROOM FOR A CROWD",
    body: "Up to 1000 slots and 16 GB per server. Paper, Purpur, Pufferfish or Folia when you need the multithreading.",
  },
  {
    title: "REAL CONSOLE",
    body: "Live streaming console with command history, a file manager with an editor, scheduled backups, one-click restore.",
  },
];

const FAQ = [
  {
    q: "How is it free with no ads?",
    a: "Servers sleep when the last player leaves, so a node runs many more servers than it has RAM. That efficiency is the whole model — no advertising, no priority queue to buy, no plugin paywall.",
  },
  {
    q: "Is there really no plugin limit?",
    a: "Correct. Install every plugin your RAM can hold. The panel searches Modrinth, Hangar and SpigotMC and pulls in required dependencies automatically.",
  },
  {
    q: "Can Bedrock and Java players play together?",
    a: "Yes. Pick any Paper-family or Fabric software and turn on crossplay — Geyser and Floodgate are installed and configured for you, and the server gets a Bedrock port alongside the Java one.",
  },
  {
    q: "Does it run on my own machine?",
    a: "It can. A node is any Linux box with Docker, and playit.gg tunnelling means it needs no public IP, no domain and no port forwarding. A free Oracle Cloud instance works too.",
  },
  {
    q: "Do I keep my world?",
    a: "Always. Download a full backup any time, upload an existing world, or restore a snapshot with one click. Backups are plain .tar.gz files.",
  },
];

export default async function LandingPage() {
  const user = isConfigured() ? await getUser() : null;

  return (
    <div className="bg-slab-void text-slab-ink">
      {/* ---- Nav: square slabs, notched mark, amber active ---------------- */}
      <header className="sticky top-0 z-40 flex h-[60px] items-stretch gap-[5px] bg-slab-bar">
        <SlabMark />

        {NAV.map((item) => (
          <Slab
            key={item.label}
            href={item.href}
            tone={item.active ? "amber-on" : "face"}
            className="hidden text-[22px] sm:flex"
            style={{ flex: item.flex }}
          >
            {item.label}
          </Slab>
        ))}

        {/* Mobile keeps only the wordmark and the sign-in slab. */}
        <div className="flex-1 sm:hidden" />

        <Link
          href={user ? "/dashboard" : "/login"}
          className="slab-lime flex w-[190px] shrink-0 items-center gap-3 px-3.5"
        >
          <span className="grid size-[22px] shrink-0 place-items-center border-[3px] border-slab-ink font-display text-xs font-bold">
            →
          </span>
          <span className="font-display text-base font-bold leading-[1.05] tracking-[.09em]">
            {user ? (
              <>
                OPEN
                <br />
                PANEL
              </>
            ) : (
              <>
                SIGN IN
                <br />
                TO HOWL
              </>
            )}
          </span>
        </Link>
      </header>

      {/* ---- Hero -------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="pixel-field absolute inset-0" aria-hidden />
        {/* Ground plane, echoing the design's grass + dirt bands. */}
        <div className="absolute inset-x-0 bottom-0" aria-hidden>
          <div className="h-[26px] bg-[#2f4a20]" />
          <div className="h-[110px] bg-[#241a12]" />
        </div>

        <div className="relative z-10 px-5 pt-3">
          <span className="inline-block bg-[#25262580] px-4 py-2.5 font-display text-sm font-bold tracking-[.13em] text-slab-soft shadow-[inset_0_0_0_2px_#3a3c3a]">
            COMING SOON: MODPACK QUEUES
          </span>
        </div>

        <div className="relative z-10 px-6 pb-[150px] pt-11 text-center">
          <h1 className="pixel-shadow mx-auto max-w-4xl font-display text-[38px] font-bold leading-none tracking-[.02em] sm:text-[62px]">
            #1 FREE MINECRAFT <span className="text-amber-500">SERVER HOST</span>
          </h1>
          <p className="mt-3.5 font-display text-[15px] font-bold tracking-[.1em] text-slab-soft sm:text-[17px]">
            RUNS IN YOUR BROWSER · NO QUEUE · FREE FOREVER
          </p>

          <div className="mt-8 flex justify-center gap-2">
            <Slab
              href={user ? "/dashboard/new" : "/signup"}
              tone="amber"
              className="w-full max-w-[520px] py-5 text-[20px] tracking-[.09em] sm:text-[26px]"
            >
              CREATE A SERVER
            </Slab>
            <Slab
              href="#features"
              tone="amber"
              className="w-16 shrink-0 text-xl"
              aria-label="Jump to features"
            >
              ▾
            </Slab>
          </div>

          <div className="mt-2.5 flex justify-center">
            <Slab
              href="#software"
              tone="sky"
              className="w-full max-w-[592px] flex-col py-3.5 text-[19px] tracking-[.08em] sm:text-2xl"
            >
              BROWSE {SOFTWARE.length} SERVER SOFTWARES
              <span className="mt-1 font-mono text-[13px] font-normal normal-case tracking-normal text-slab-soft">
                Fabric · Forge · NeoForge · Paper · Vanilla · Bedrock
              </span>
            </Slab>
          </div>
        </div>
      </section>

      {/* ---- Features ---------------------------------------------------- */}
      <section id="features" className="border-t-4 border-slab-bar px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-3xl font-bold tracking-[.06em] sm:text-4xl">
            EVERYTHING THE PAID PANELS GATE
          </h2>
          <p className="mt-3 max-w-2xl font-mono text-sm text-slab-soft">
            Howl.Host ships the whole control panel to everyone. There is no upgrade
            button, because there is nothing above this tier.
          </p>

          <div className="mt-9 grid gap-[5px] sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="slab-face p-5 transition-colors hover:bg-slab-hover"
              >
                <h3 className="font-display text-lg font-bold tracking-[.08em] text-amber-500">
                  {f.title}
                </h3>
                <p className="mt-2 font-mono text-[13px] leading-relaxed text-slab-soft">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Software ---------------------------------------------------- */}
      <section id="software" className="border-t-4 border-slab-bar bg-[#0b0c0b] px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-3xl font-bold tracking-[.06em] sm:text-4xl">
            {SOFTWARE.length} SOFTWARES, ONE CLICK
          </h2>
          <p className="mt-3 max-w-2xl font-mono text-sm text-slab-soft">
            Switch software or Minecraft version whenever you like. Your world, plugins
            and settings stay put.
          </p>

          <div className="mt-9 grid gap-[5px] sm:grid-cols-2 lg:grid-cols-3">
            {SOFTWARE.map((s) => (
              <div key={s.id} className="slab-face flex flex-col p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-lg font-bold tracking-[.08em] text-slab-ink">
                    {s.name}
                  </h3>
                  <span
                    className={`font-mono text-[10px] uppercase ${
                      s.edition === "bedrock"
                        ? "text-status-info"
                        : s.proxy
                          ? "text-sky-400"
                          : "text-status-up"
                    }`}
                  >
                    {s.edition === "bedrock" ? "Bedrock" : s.proxy ? "Proxy" : "Java"}
                  </span>
                </div>
                <p className="mt-2 flex-1 font-mono text-xs leading-relaxed text-slab-soft">
                  {s.blurb}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase text-slab-dim">
                  {s.supports.plugins && <span>Plugins</span>}
                  {s.supports.mods && <span>Mods</span>}
                  {s.supports.datapacks && <span>Datapacks</span>}
                  {s.supports.crossplay && <span className="text-status-info">Crossplay</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- FAQ --------------------------------------------------------- */}
      <section id="faq" className="border-t-4 border-slab-bar px-5 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-3xl font-bold tracking-[.06em]">QUESTIONS</h2>
          <div className="mt-8 space-y-[5px]">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="slab-face group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-display text-base font-bold tracking-[.05em] text-slab-ink">
                  {q}
                  <span className="font-display text-amber-500 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                </summary>
                <p className="mt-3 font-mono text-[13px] leading-relaxed text-slab-soft">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---- CTA + footer ------------------------------------------------ */}
      <section className="border-t-4 border-slab-bar px-5 py-20 text-center">
        <h2 className="pixel-shadow font-display text-3xl font-bold tracking-[.04em] sm:text-5xl">
          YOUR SERVER IS ONE CLICK AWAY
        </h2>
        <p className="mx-auto mt-4 max-w-md font-mono text-sm text-slab-soft">
          Make an account, pick a version, share the address. That is the whole flow.
        </p>
        <div className="mt-8 flex justify-center">
          <Slab
            href={user ? "/dashboard/new" : "/signup"}
            tone="amber"
            className="w-full max-w-[420px] py-5 text-xl tracking-[.09em] sm:text-2xl"
          >
            {user ? "CREATE A SERVER" : "CREATE FREE ACCOUNT"}
          </Slab>
        </div>
      </section>

      <footer className="border-t-4 border-slab-bar bg-slab-bar px-5 py-7">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 font-mono text-[11px] text-slab-dim sm:flex-row">
          <span>Howl.Host — free Minecraft hosting, no ads.</span>
          <div className="flex flex-wrap items-center justify-center gap-5">
            <span>No tracking</span>
            <span>Sleeps when idle</span>
            <span>Not affiliated with Mojang</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

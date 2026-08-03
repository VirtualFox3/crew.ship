import Link from "next/link";
import { SOFTWARE } from "@/lib/software";
import { getUser } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const FEATURES = [
  ["01", "DOWNLOAD THE HOST APP", "A lightweight native app runs Minecraft quietly on your computer and keeps your files local."],
  ["02", "PICK ANY VERSION", "Vanilla, Paper, Fabric, Forge, NeoForge, Bedrock and modpacks use compatible live version lists."],
  ["03", "SHARE THE ADDRESS", "Built-in playit.gg tunnelling means no port forwarding and no exposed home IP."],
];

export default async function LandingPage() {
  const user = isConfigured() ? await getUser() : null;
  const start = "/download";
  return <main className="min-h-screen bg-[#f3f8f6] text-[#031412]">
    <header className="flex h-16 items-center justify-between border-b border-[#031412]/15 px-5 sm:px-8">
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2 font-sans text-lg font-extrabold tracking-tight">
          <span className="size-5 bg-[#031412] shadow-[inset_5px_5px_0_#4fd1c0]" />Howl.Host
        </Link>
        <nav className="hidden gap-6 font-mono text-xs font-semibold text-[#031412]/55 md:flex">
          <a href="#software" className="text-[#031412]">MODPACKS</a><a href="#how">HOW IT WORKS</a><Link href="/dashboard">DASHBOARD</Link><a href="#faq">DOCS</a>
        </nav>
      </div>
      <div className="flex items-center gap-4 font-mono text-xs font-bold">
        <Link href={user ? "/dashboard" : "/login"}>LOG IN</Link>
        <Link href={start} className="bg-[#031412] px-4 py-2.5 text-[#4fd1c0] shadow-[0_4px_0_#4fd1c0]">DOWNLOAD APP</Link>
      </div>
    </header>

    <section className="relative mx-auto max-w-[1180px] overflow-hidden px-5 pb-10 pt-12 sm:px-8 lg:pt-16">
      <div className="relative z-10 max-w-[650px]">
        <div className="mb-5 inline-flex items-center gap-2 bg-[#c9f0ea] px-3 py-1.5 font-mono text-[11px] font-bold tracking-widest"><span className="size-2 bg-[#031412]" />FREE · NO QUEUE · YOUR OWN PC</div>
        <h1 className="text-balance font-sans text-5xl font-extrabold leading-[.94] tracking-[-.055em] sm:text-7xl lg:text-[76px]">Your server.<br/><span className="bg-[#4fd1c0] px-2">Your computer.</span></h1>
        <p className="mt-6 max-w-[500px] text-base leading-relaxed text-[#031412]/68">Howl.Host works like SquidServers: the host app runs the world on the machine you already own. It stays free, has no hosting queue, and supports as many friends as your hardware can handle.</p>
        <div className="mt-8 flex flex-wrap gap-3 font-mono text-sm font-bold">
          <Link href={start} className="bg-[#031412] px-6 py-4 text-[#4fd1c0] shadow-[0_6px_0_#4fd1c0]">GET THE WINDOWS APP</Link>
          <a href="#how" className="border-2 border-[#031412] px-5 py-3.5">macOS · LINUX</a>
        </div>
        <div className="mt-10 flex gap-9 border-t border-[#031412]/15 pt-5">
          <Stat value="$0" label="forever"/><Stat value="0" label="hosting queues"/><Stat value={`${SOFTWARE.length}`} label="server softwares"/>
        </div>
      </div>
      <div className="mt-12 grid h-64 place-items-center border border-dashed border-[#031412]/25 bg-[repeating-linear-gradient(135deg,#e4f2ef_0_8px,#d7ebe7_8px_16px)] lg:absolute lg:bottom-0 lg:right-8 lg:mt-0 lg:h-[356px] lg:w-[404px]">
        <div className="flex items-end gap-8">
          <Mascot color="#4fd1c0" name="BLOCKY" size="size-20"/><Mascot color="#a98bf0" name="MODDY" size="size-14"/><Mascot color="#f2cb3c" name="SPARK" size="size-16"/>
        </div>
      </div>
    </section>

    <section id="how" className="grid border-y border-[#031412]/15 md:grid-cols-3">
      {FEATURES.map(([number,title,body]) => <article key={number} className="border-[#031412]/15 p-7 md:border-r">
        <p className="font-mono text-xs font-bold tracking-widest text-[#0c8578]">{number} · {title}</p><p className="mt-3 text-sm leading-relaxed text-[#031412]/70">{body}</p>
      </article>)}
    </section>

    <section id="software" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="font-mono text-xs font-bold tracking-widest text-[#0c8578]">LIVE COMPATIBILITY CATALOGUE</p>
      <h2 className="mt-2 text-4xl font-extrabold tracking-tight">Every way to run Minecraft.</h2>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{SOFTWARE.map(s => <div key={s.id} className="border-2 border-[#031412] bg-white/55 p-4 shadow-[4px_4px_0_#4fd1c0]"><h3 className="font-bold">{s.name}</h3><p className="mt-2 text-xs leading-relaxed text-[#031412]/60">{s.blurb}</p></div>)}</div>
    </section>

    <footer id="faq" className="flex flex-wrap justify-between gap-4 bg-[#031412] px-8 py-7 font-mono text-xs text-[#4fd1c0]"><span>HOWL.HOST · SELF-HOSTED MINECRAFT</span><span>YOUR WORLD · YOUR HARDWARE · YOUR FILES</span></footer>
  </main>;
}

function Stat({value,label}:{value:string,label:string}) { return <div><div className="text-2xl font-extrabold">{value}</div><div className="font-mono text-[11px] text-[#031412]/50">{label}</div></div>; }
function Mascot({color,name,size}:{color:string,name:string,size:string}) { return <div className="text-center"><div style={{background:color}} className={`${size} flex items-center justify-center gap-2 border-[3px] border-[#031412] shadow-[7px_7px_0_#031412]`}><i className="h-3 w-2 bg-[#031412]"/><i className="h-3 w-2 bg-[#031412]"/></div><p className="mt-3 font-mono text-[10px] font-bold">{name}</p></div>; }

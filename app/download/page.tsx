import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Crew.Ship Desktop — Official downloads", description: "Download the official Crew.Ship Windows app to host Minecraft servers locally." };

const RELEASES = "https://github.com/VirtualFox3/Crew.Ship/releases";
const LATEST_RELEASE = "https://github.com/VirtualFox3/Crew.Ship/releases/latest";

export default function DownloadPage() {
  return <main className="min-h-screen overflow-hidden bg-[#ededed] text-[#1d2028]">
    <header className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
      <Link href="/" className="flex items-center gap-3" aria-label="Crew.Ship home"><PixelShip compact /><span className="font-mono text-sm font-black tracking-[.13em]">CREW.SHIP</span></Link>
      <div className="flex items-center gap-5 font-mono text-[11px] font-bold tracking-[.08em]"><Link href="/dashboard" className="hidden text-[#4b5363] hover:text-[#2558cf] sm:block">WEB PANEL</Link><a href={RELEASES} className="border border-[#1d2028] bg-white px-4 py-2.5 shadow-[3px_3px_0_#1d2028]">ALL RELEASES ↗</a></div>
    </header>

    <section className="relative mx-auto max-w-7xl px-5 pb-12 pt-5 sm:px-8 lg:pb-20 lg:pt-12">
      <div className="absolute right-[-10vw] top-20 h-[420px] w-[420px] border-[36px] border-[#2d61dc]/10 sm:h-[620px] sm:w-[620px]" />
      <div className="relative grid gap-12 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div className="max-w-2xl">
          <div className="mb-7 inline-flex items-center gap-3 border border-[#cbd0d9] bg-white px-3 py-2 font-mono text-[10px] font-bold tracking-[.12em] text-[#3c4658]"><span className="size-2 bg-[#4dd08b] shadow-[0_0_0_3px_#dff7eb]" />OFFICIAL DESKTOP RELEASES</div>
          <h1 className="font-mono text-5xl font-black leading-[.88] tracking-[-.09em] text-[#151820] sm:text-7xl lg:text-[82px]">YOUR WORLD.<br />YOUR MACHINE.<br /><span className="text-[#2d61dc]">YOUR CREW.</span></h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-[#586174]">Crew.Ship is the local Minecraft host. It installs official server software, runs worlds on your PC, shows your LAN address, and lets you share server access with people you trust.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4"><a href={LATEST_RELEASE} className="group inline-flex items-center gap-3 bg-[#2d61dc] px-6 py-4 font-mono text-sm font-black tracking-[.05em] text-white shadow-[7px_7px_0_#dc5367] transition-transform hover:-translate-y-1"><span className="text-lg">↓</span> DOWNLOAD FOR WINDOWS</a><span className="font-mono text-[10px] leading-relaxed tracking-[.08em] text-[#6b7384]">WINDOWS 10/11 · X64<br />LOCAL HOST · FREE</span></div>
          <p className="mt-6 max-w-lg border-l-2 border-[#dc5367] pl-3 text-xs leading-relaxed text-[#626b7c]">The installer is published only on our official GitHub Releases page. Windows can show a reputation warning for brand-new unsigned builds—always verify that the link opens the VirtualFox3/Crew.Ship release page.</p>
        </div>

        <div className="relative mx-auto w-full max-w-[530px] border-2 border-[#1d2028] bg-[#22252d] p-4 shadow-[12px_12px_0_#dc5367]">
          <div className="flex items-center justify-between border-b border-white/15 pb-4 font-mono text-[10px] font-bold tracking-[.12em] text-[#cbd4e7]"><span>CREW.SHIP / DESKTOP</span><span className="text-[#63db9e]">● LOCAL HOST READY</span></div>
          <div className="grid gap-5 py-7 sm:grid-cols-[150px_1fr] sm:items-center"><div className="grid place-items-center border border-white/10 bg-[#191b20] py-7"><PixelShip /></div><div><p className="font-mono text-[10px] font-bold tracking-[.13em] text-[#8daefa]">RELEASE CHANNEL</p><h2 className="mt-2 font-mono text-3xl font-black tracking-[-.07em] text-white">DESKTOP v0.5.4</h2><p className="mt-3 text-sm leading-relaxed text-[#aeb7c8]">A server workspace with options, console, logs, files, worlds, backups, access invites, and Marketplace.</p></div></div>
          <div className="grid grid-cols-3 border border-white/10 font-mono"><ReleaseFact value="LOCAL" label="SERVER HOST" /><ReleaseFact value="MODS" label="MARKETPLACE" /><ReleaseFact value="LINKS" label="CREW ACCESS" /></div>
        </div>
      </div>
    </section>

    <section className="border-y border-[#c8cdd7] bg-white"><div className="mx-auto grid max-w-7xl divide-y divide-[#c8cdd7] px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0"><Step number="01" title="Download" text="Get the official Windows installer from GitHub Releases." /><Step number="02" title="Build your server" text="Choose Vanilla, Paper, Fabric, Forge, NeoForge, or Purpur." /><Step number="03" title="Invite your crew" text="Give admins access by username or a one-use invite link." /></div></section>
  </main>;
}

function PixelShip({ compact = false }: { compact?: boolean }) {
  const size = compact ? "scale-[.48] origin-left" : "scale-100";
  return <span aria-hidden="true" className={`relative block h-24 w-28 ${size}`}><i className="absolute bottom-2 left-3 h-3 w-20 bg-[#f4f5f7] shadow-[6px_6px_0_#2d61dc,12px_6px_0_#f4f5f7,18px_6px_0_#f4f5f7,24px_6px_0_#f4f5f7,30px_6px_0_#f4f5f7,36px_6px_0_#f4f5f7,42px_6px_0_#f4f5f7]" /><i className="absolute bottom-0 left-8 h-1.5 w-14 bg-[#2d61dc]" /><i className="absolute left-[51px] top-2 h-16 w-2 bg-[#f4f5f7]" /><i className="absolute left-[59px] top-3 h-8 w-10 bg-[#dc5367]" /><i className="absolute left-4 top-7 h-10 w-9 bg-[#2d61dc]" /><i className="absolute left-7 top-10 h-3 w-3 bg-[#d9e7ff]" /><i className="absolute left-[11px] top-[51px] h-3 w-4 bg-[#d9e7ff]" /></span>;
}

function ReleaseFact({ value, label }: { value: string; label: string }) { return <div className="p-4"><b className="text-lg text-white">{value}</b><p className="mt-1 text-[8px] tracking-[.12em] text-[#8f99ab]">{label}</p></div>; }
function Step({ number, title, text }: { number: string; title: string; text: string }) { return <article className="px-0 py-6 md:px-7"><span className="font-mono text-[10px] font-bold text-[#dc5367]">{number}</span><h2 className="mt-3 font-mono text-xl font-black tracking-[-.06em]">{title}</h2><p className="mt-2 text-sm leading-relaxed text-[#657082]">{text}</p></article>; }

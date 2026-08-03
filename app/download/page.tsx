import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Download Howl.Host" };

const WINDOWS_RELEASE = "https://github.com/VirtualFox3/Pack.Host/releases/latest";

export default function DownloadPage() {
  return (
    <main className="min-h-screen bg-[#f3f8f6] text-[#031412]">
      <header className="flex h-16 items-center justify-between border-b border-[#031412]/15 px-6 sm:px-10">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold">
          <span className="size-5 bg-[#031412] shadow-[inset_5px_5px_0_#4fd1c0]" /> Howl.Host
        </Link>
        <Link href="/dashboard" className="font-mono text-xs font-bold">OPEN WEB PANEL</Link>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1fr_420px] lg:items-center lg:py-24">
        <div>
          <p className="font-mono text-xs font-bold tracking-[.16em] text-[#0c8578]">HOWL.HOST DESKTOP · TAURI 2</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-extrabold leading-[.94] tracking-[-.05em] sm:text-7xl">Your PC is the host.</h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-[#031412]/65">
            A lightweight native application manages Fabric, your worlds, and playit.gg. Minecraft runs quietly in the background and your files stay on your computer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={WINDOWS_RELEASE} className="bg-[#031412] px-6 py-4 font-mono text-sm font-bold text-[#4fd1c0] shadow-[0_6px_0_#4fd1c0]">DOWNLOAD FOR WINDOWS</a>
            <Link href="/account#host-computer" className="border-2 border-[#031412] px-5 py-3.5 font-mono text-sm font-bold">BACK TO ACCOUNT</Link>
          </div>
          <p className="mt-5 font-mono text-[11px] text-[#031412]/50">WINDOWS 10/11 · X64 · NO DOCKER REQUIRED</p>
        </div>

        <div className="border-[3px] border-[#031412] bg-[#0c0907] p-5 text-[#f4efe5] shadow-[12px_12px_0_#4fd1c0]">
          <div className="flex items-center justify-between border-b border-[#3a2c20] pb-4 font-mono text-xs"><b>HOWL.HOST</b><span className="text-[#6dd17c]">● HOST ONLINE</span></div>
          <div className="py-7"><p className="font-mono text-[10px] tracking-widest text-[#927d69]">YOUR SERVERS</p><h2 className="mt-2 text-2xl font-bold">Friends SMP</h2><p className="mt-2 text-sm text-[#958578]">Fabric · Minecraft 1.21.8 · 4 GB</p></div>
          <div className="grid grid-cols-2 border border-[#3a2c20]"><div className="border-r border-[#3a2c20] p-4"><b className="text-xl text-[#f5ae3d]">READY</b><p className="mt-1 font-mono text-[9px] text-[#75675d]">JAVA</p></div><div className="p-4"><b className="text-xl">LOCAL</b><p className="mt-1 font-mono text-[9px] text-[#75675d]">STORAGE</p></div></div>
        </div>
      </section>
    </main>
  );
}

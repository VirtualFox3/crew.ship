import type { Metadata } from "next";
import Link from "next/link";
import s from "./landing.module.css";

export const metadata: Metadata = { title: "Crew.Ship — Local Minecraft server hosting", description: "Host it. Own it. Crew it. Run your Minecraft server on your own computer with Crew.Ship.", icons: { icon: "/favicon.ico" } };

const steps = [
  ["Create", "Pick Vanilla, Paper, Purpur, Fabric, Forge, or NeoForge. Crew.Ship gets the official build."],
  ["Run locally", "Your world uses your computer, your storage, and your own Minecraft server folder."],
  ["Share", "Invite admins by Crew.Ship username or a single-use link. Use playit.gg for a public address."],
];
const features = [
  ["Server options", "Slots, whitelist, difficulty, keep inventory, resource packs, and more."],
  ["Marketplace", "Install compatible mods and plugins through Modrinth."],
  ["Files & worlds", "Open local folders whenever you need full control of your data."],
  ["Console & crew", "Console, logs, player controls, backups, and access invites."],
];

export default function LandingPage() {
  return <main className={s.page}>
    <a href="#main" className={s.skip}>Skip to content</a>
    <header className={s.header}>
      <Link href="/" className={s.brand}><img src="/brand/ship.svg" width="48" height="48" alt="" />Crew.Ship</Link>
      <nav aria-label="Main navigation"><a href="#how">How it works</a><a href="#features">Features</a><Link href="/download">Download</Link></nav>
      <div className={s.account}><Link href="/login">Log in</Link><Link href="/download" className={s.smallButton}>Get the app</Link></div>
    </header>
    <section className={s.hero} id="main">
      <div><p className={s.eyebrow}><span /> Minecraft, on your computer</p><h1>Host it.<br />Own it.<br />Crew it.</h1><p className={s.description}>Crew.Ship is a native Minecraft host for the PC you already have. Create a world, install add-ons, share access with your crew, and keep every file right where it belongs.</p><div className={s.actions}><Link href="/download" className={s.primary}>Download for Windows <span aria-hidden="true">↓</span></Link><Link href="/login" className={s.secondary}>Open web panel</Link></div><p className={s.note}>Windows 10 / 11 · Your PC stays on while you host.</p></div>
    </section>
    <section id="how" className={s.steps} aria-label="How it works">{steps.map(([title, text], index) => <article key={title}><span className={s.stepNumber}>0{index + 1}</span><h2>{title}</h2><p>{text}</p></article>)}</section>
    <section id="features" className={s.features}><div className={s.featureHeading}><div><p className={s.eyebrow}>Built for a local host</p><h2>Your server has<br />a real control room.</h2></div><p>The tools to make it yours.<br />The freedom to keep it yours.</p></div><div className={s.featureGrid}>{features.map(([title, text], i) => <article key={title}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={['M4 7h16M4 17h16M8 4v6M16 14v6','M4 8l8-4 8 4v10l-8 4-8-4V8zm0 0l8 4 8-4m-8 4v10','M3 6h7l2 3h9v11H3V6z','M4 6l5 5-5 5m8 1h8'][i]} /></svg><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <footer className={s.footer}><Link href="/" className={s.brand}><img src="/brand/ship.svg" width="38" height="38" alt="" />Crew.Ship</Link><p>Local Minecraft hosting.<br /><span>Independent project. Not affiliated with Mojang or Microsoft.</span></p><a href="https://github.com/VirtualFox3/Crew.Ship">GitHub ↗</a></footer>
  </main>;
}

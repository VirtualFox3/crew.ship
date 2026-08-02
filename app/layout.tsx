import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Howl.Host — Free Minecraft server hosting, no ads",
    template: "%s · Howl.Host",
  },
  description:
    "Free Minecraft servers with unlimited plugins and mods, Java and Bedrock crossplay, every version, and no queue. Runs on your own machine.",
  keywords: [
    "free minecraft server hosting",
    "minecraft server",
    "java",
    "bedrock",
    "modded server",
    "paper",
    "fabric",
    "forge",
  ],
  openGraph: {
    title: "Howl.Host — Free Minecraft server hosting",
    description:
      "Unlimited plugins and mods. Java + Bedrock. Every version. No ads, no queue, no paywall.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0f0e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Loaded with <link> rather than next/font: the three families split
          across two visual registers, and next/font would inline all of them
          into every route's critical CSS. preconnect keeps the handshake off
          the critical path.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&family=Pixelify+Sans:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

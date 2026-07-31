import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pack.Host — Free Minecraft server hosting, no ads",
    template: "%s · Pack.Host",
  },
  description:
    "Free Minecraft servers with unlimited plugins and mods, Java and Bedrock crossplay, every version, and no ads. Ever.",
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
    title: "Pack.Host — Free Minecraft server hosting",
    description:
      "Unlimited plugins and mods. Java + Bedrock. Every version. No ads, no queue tax, no paywall.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">{children}</body>
    </html>
  );
}

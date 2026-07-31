import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.modrinth.com" },
      { protocol: "https", hostname: "www.spigotmc.org" },
      { protocol: "https", hostname: "hangarcdn.papermc.io" },
      { protocol: "https", hostname: "mc-heads.net" },
    ],
  },
};

export default nextConfig;

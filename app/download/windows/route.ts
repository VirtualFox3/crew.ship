import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const repository = "https://github.com/VirtualFox3/crew.ship";
export async function GET(request: Request) {
  const msi = new URL(request.url).searchParams.get("format") === "msi";
  try {
    const response = await fetch("https://api.github.com/repos/VirtualFox3/crew.ship/releases?per_page=20", { next: { revalidate: 60 }, headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Releases unavailable");
    const releases = await response.json() as Array<{ draft: boolean; prerelease: boolean; tag_name: string; assets: Array<{name: string; browser_download_url: string}> }>;
    const pattern = msi ? /^Crew\.Ship_[0-9.]+_x64_en-US\.msi$/ : /^Crew\.Ship_[0-9.]+_x64-setup\.exe$/;
    // GitHub's list order is not necessarily semantic version order.
    releases.sort((a, b) => {
      const av = a.tag_name.replace(/^desktop-v/, "").split(".").map(Number);
      const bv = b.tag_name.replace(/^desktop-v/, "").split(".").map(Number);
      for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const difference = (bv[i] || 0) - (av[i] || 0);
        if (difference) return difference;
      }
      return 0;
    });
    for (const release of releases) {
      if (release.draft || release.prerelease || !release.tag_name.startsWith("desktop-v")) continue;
      const asset = release.assets.find(a => pattern.test(a.name) && a.browser_download_url.toLowerCase().startsWith(repository.toLowerCase() + "/releases/download/"));
      if (asset) return NextResponse.redirect(asset.browser_download_url, 307);
    }
  } catch { /* Keep a useful path to official downloads if GitHub is unavailable. */ }
  return NextResponse.redirect(repository + "/releases", 307);
}

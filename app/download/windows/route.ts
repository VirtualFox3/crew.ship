import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const repository = "https://github.com/VirtualFox3/Crew.Ship";
export async function GET(request: Request) {
  const msi = new URL(request.url).searchParams.get("format") === "msi";
  // Public artifact hosting can be separate from the private source repository.
  const hostedInstaller = msi ? process.env.CREWSHIP_WINDOWS_MSI_URL : process.env.CREWSHIP_WINDOWS_EXE_URL;
  if (hostedInstaller) {
    try {
      const url = new URL(hostedInstaller);
      if (url.protocol === "https:" && !url.username && !url.password) return NextResponse.redirect(url, 307);
    } catch { /* Invalid configuration falls back to release discovery. */ }
  }
  try {
    const response = await fetch("https://api.github.com/repos/VirtualFox3/Crew.Ship/releases?per_page=20", { next: { revalidate: 300 }, headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Releases unavailable");
    const releases = await response.json() as Array<{ draft: boolean; prerelease: boolean; tag_name: string; assets: Array<{name: string; browser_download_url: string}> }>;
    const pattern = msi ? /^Crew\.Ship_[0-9.]+_x64_en-US\.msi$/ : /^Crew\.Ship_[0-9.]+_x64-setup\.exe$/;
    for (const release of releases) {
      if (release.draft || release.prerelease || !release.tag_name.startsWith("desktop-v")) continue;
      const asset = release.assets.find(a => pattern.test(a.name) && a.browser_download_url.startsWith(repository + "/releases/download/"));
      if (asset) return NextResponse.redirect(asset.browser_download_url, 307);
    }
  } catch { /* Keep a useful path to official downloads if GitHub is unavailable. */ }
  return NextResponse.redirect(repository + "/releases", 307);
}

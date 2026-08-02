import Link from "next/link";
import { LogOut, Plus, User as UserIcon } from "lucide-react";
import { SlabMark } from "@/components/slab";
import type { Profile } from "@/lib/types";

/**
 * Panel chrome.
 *
 * Keeps the landing page's slab mark so the two registers read as one product,
 * then drops into the calmer panel vocabulary — Bricolage headings, IBM Plex
 * Mono for anything the machine produced, hairline rules instead of 3px slabs.
 */
export function AppShell({
  profile,
  children,
}: {
  profile: Pick<Profile, "username" | "avatar_url"> | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-950">
      <header className="sticky top-0 z-40 border-b border-ink-700/70 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-stretch gap-4 pr-4">
          <Link href="/dashboard" className="flex items-stretch gap-0">
            <SlabMark compact />
          </Link>

          <nav className="hidden items-center gap-1 font-mono text-xs uppercase tracking-wider sm:flex">
            <Link
              href="/dashboard"
  className="px-3 py-1.5 text-ink-300 transition-colors hover:text-grass-400"
            >
              Servers
            </Link>
            <Link
              href="/account"
  className="px-3 py-1.5 text-ink-300 transition-colors hover:text-grass-400"
            >
              Account
            </Link>
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2">
            <Link
              href="/dashboard/new"
  className="flex items-center gap-1.5 border border-grass-500 bg-grass-500/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-grass-400 transition-colors hover:bg-grass-500/20"
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">New server</span>
            </Link>

            <div className="flex items-center gap-2 border border-ink-700 py-1 pl-2.5 pr-1">
              <span className="flex items-center gap-1.5 font-mono text-xs text-ink-300">
                <UserIcon className="size-3.5" />
                <span className="hidden max-w-24 truncate sm:inline">
                  {profile?.username ?? "you"}
                </span>
              </span>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
  className="grid size-6 place-items-center text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
                >
                  <LogOut className="size-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}

import Link from "next/link";
import { LogOut, Plus, Server, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui";
import type { Profile } from "@/lib/types";

/** Top bar shared by every signed-in page. */
export function AppShell({
  profile,
  children,
}: {
  profile: Pick<Profile, "username" | "avatar_url"> | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-grass-500 text-ink-950">
                <Server className="size-4" strokeWidth={2.5} />
              </span>
              <span className="text-sm font-semibold tracking-tight">
                Pack<span className="text-grass-400">.Host</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm sm:flex">
              <Link
                href="/dashboard"
                className="rounded-lg px-3 py-1.5 text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100"
              >
                Servers
              </Link>
              <Link
                href="/account"
                className="rounded-lg px-3 py-1.5 text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100"
              >
                Account
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/dashboard/new">
              <Button size="sm">
                <Plus className="size-4" />
                <span className="hidden sm:inline">New server</span>
              </Button>
            </Link>

            <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 py-1 pl-2 pr-1">
              <span className="flex items-center gap-1.5 text-xs text-ink-300">
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
                  className="grid size-6 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
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

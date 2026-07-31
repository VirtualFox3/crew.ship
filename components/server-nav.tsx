"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Blocks,
  FolderTree,
  Globe,
  LayoutDashboard,
  Puzzle,
  Settings,
  Sliders,
  Users,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export function ServerNav({
  serverId,
  supportsPlugins,
  supportsMods,
}: {
  serverId: string;
  supportsPlugins: boolean;
  supportsMods: boolean;
}) {
  const pathname = usePathname();
  const base = `/server/${serverId}`;

  const items: NavItem[] = [
    { href: base, label: "Overview", icon: LayoutDashboard },
    ...(supportsPlugins || supportsMods
      ? [
          {
            href: `${base}/addons`,
            label: supportsMods ? "Mods" : "Plugins",
            icon: supportsMods ? Blocks : Puzzle,
          },
        ]
      : []),
    { href: `${base}/software`, label: "Software", icon: Sliders },
    { href: `${base}/worlds`, label: "Worlds", icon: Globe },
    { href: `${base}/players`, label: "Players", icon: Users },
    { href: `${base}/files`, label: "Files", icon: FolderTree },
    { href: `${base}/backups`, label: "Backups", icon: Archive },
    { href: `${base}/options`, label: "Options", icon: Settings },
    { href: `${base}/access`, label: "Access", icon: UserPlus },
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
              active
                ? "bg-grass-500/12 font-medium text-grass-300"
                : "text-ink-400 hover:bg-ink-800 hover:text-ink-100",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

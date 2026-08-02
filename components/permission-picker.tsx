"use client";

import { Check, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  CAPABILITY_INFO,
  ROLE_PRESETS,
  describePermissions,
  type Capability,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { AccessRole } from "@/lib/types";

/**
 * Ticks exactly what one person may do.
 *
 * Presets are a starting point rather than the choice itself — most owners
 * want "a moderator, but no file access", and forcing that into a named tier
 * is how people end up handing out more than they meant to.
 */
export function PermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: Capability[];
  onChange: (next: Capability[]) => void;
  disabled?: boolean;
}) {
  function toggle(cap: Capability) {
    onChange(value.includes(cap) ? value.filter((c) => c !== cap) : [...value, cap]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-400">Start from:</span>
        {(Object.keys(ROLE_PRESETS) as Exclude<AccessRole, "owner">[]).map((role) => (
          <button
            key={role}
            type="button"
            disabled={disabled}
            onClick={() => onChange([...ROLE_PRESETS[role]])}
  className="border border-ink-600 px-2.5 py-1 text-xs capitalize text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100 disabled:opacity-50"
          >
            {role}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([])}
  className="border border-ink-600 px-2.5 py-1 text-xs text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100 disabled:opacity-50"
        >
          None
        </button>
        <Badge tone={value.length ? "grass" : "neutral"} className="ml-auto">
          {describePermissions(value)}
        </Badge>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {CAPABILITY_INFO.map((cap) => {
          const on = value.includes(cap.id);
          return (
            <button
              key={cap.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(cap.id)}
  className={cn(
                "flex items-start gap-2.5  border p-3 text-left transition-colors disabled:opacity-50",
                on
                  ? "border-grass-500/50 bg-grass-500/8"
                  : "border-ink-700 bg-ink-850/40 hover:border-ink-600",
              )}
            >
              <span
  className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                  on ? "border-grass-500 bg-grass-500 text-ink-950" : "border-ink-600",
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm text-ink-100">
                  {cap.label}
                  {cap.sensitive && on && (
                    <TriangleAlert
  className="size-3 text-amber-400"
                      aria-label="Sensitive permission"
                    />
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
                  {cap.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {!value.length && (
        <p className="text-xs text-amber-300">
          With nothing ticked they can open the server page but do nothing at all.
          Remove them instead if that is what you want.
        </p>
      )}
    </div>
  );
}

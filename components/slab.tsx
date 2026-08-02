import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The pixel-slab vocabulary from the landing design.
 *
 * Everything is a rectangle with an inset outline and Pixelify Sans in caps.
 * No radii, no blur — the one exception is the logo tile's single notched
 * corner, which is what stops the nav reading as a plain toolbar.
 */

type SlabTone = "face" | "amber" | "amber-on" | "sky" | "lime";

const TONE: Record<SlabTone, string> = {
  face: "slab-face text-slab-muted",
  amber: "slab slab-amber",
  "amber-on": "slab-amber-on",
  sky: "slab-sky",
  lime: "slab-lime",
};

export function Slab({
  tone = "face",
  href,
  className,
  children,
  ...props
}: {
  tone?: SlabTone;
  href?: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"button">, "className" | "children">) {
  const classes = cn(
    "flex items-center justify-center text-center font-display font-bold uppercase tracking-[.11em] select-none",
    TONE[tone],
    href && "cursor-pointer",
  className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}

/** The nav's leading mark: notched tile + wordmark. */
export function SlabMark({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <div className="notch-br grid w-11 shrink-0 place-items-center bg-slab-edge font-display text-[22px] font-bold text-[#c8ccc8]">
        ❯
      </div>
      {!compact && (
        <div className="grid w-[58px] shrink-0 place-items-center font-display text-xs font-bold tracking-[.11em] text-slab-dim">
          HOWL
        </div>
      )}
    </>
  );
}

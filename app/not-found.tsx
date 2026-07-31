import Link from "next/link";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-5 text-center">
      <div>
        <p className="font-mono text-6xl font-bold text-ink-700">404</p>
        <h1 className="mt-4 text-xl font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm text-ink-400">
          That page, or that server, does not exist for your account.
        </p>
        <Link href="/dashboard" className="mt-6 inline-block">
          <Button>Back to your servers</Button>
        </Link>
      </div>
    </div>
  );
}

import { Alert, Card } from "@/components/ui";

/**
 * Shown when the deployment has no Supabase credentials yet, so a fresh clone
 * gives a useful next step instead of a stack trace.
 */
export function SetupNotice() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-24">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Pack.Host is not connected yet</h1>
        <p className="mt-2 text-sm text-ink-400">
          The panel is deployed but has no database. Add these environment variables
          and redeploy:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-ink-700 bg-ink-950 p-4 text-xs text-ink-300">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
AGENT_SHARED_SECRET=<random 32+ char string>`}
        </pre>
        <div className="mt-4">
          <Alert tone="info">
            Full walkthrough, including how to bring up a node that actually runs the
            Minecraft servers, is in <code>DEPLOY.md</code>.
          </Alert>
        </div>
      </Card>
    </div>
  );
}

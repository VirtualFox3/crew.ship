/**
 * Environment access.
 *
 * Reads are lazy and never throw at module scope so a fresh clone can be built
 * and deployed before Supabase is wired up — the panel shows a setup notice at
 * runtime instead of failing the build.
 */

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in (see DEPLOY.md).`,
    );
  }
  return value;
}

// Next.js only replaces public environment variables in client bundles when
// they are accessed statically. Dynamic `process.env[name]` lookups remain
// undefined in the browser.
export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = () =>
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** True once the panel has enough config to talk to Supabase. */
export const isConfigured = () => Boolean(supabaseUrl() && supabaseAnonKey());

export const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ??
  (optionalEnv("VERCEL_PROJECT_PRODUCTION_URL")
    ? `https://${optionalEnv("VERCEL_PROJECT_PRODUCTION_URL")}`
    : undefined) ??
  (optionalEnv("VERCEL_URL") ? `https://${optionalEnv("VERCEL_URL")}` : undefined) ??
  "http://localhost:3000";

/** Root domain servers get their address under: <subdomain>.<ROOT>. */
export const serverDomain = () => process.env.NEXT_PUBLIC_SERVER_DOMAIN ?? "howl.host";

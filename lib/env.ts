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

export const supabaseUrl = () => optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () =>
  optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
  optionalEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

/** True once the panel has enough config to talk to Supabase. */
export const isConfigured = () => Boolean(supabaseUrl() && supabaseAnonKey());

export const siteUrl = () =>
  optionalEnv("NEXT_PUBLIC_SITE_URL") ??
  (optionalEnv("VERCEL_PROJECT_PRODUCTION_URL")
    ? `https://${optionalEnv("VERCEL_PROJECT_PRODUCTION_URL")}`
    : undefined) ??
  (optionalEnv("VERCEL_URL") ? `https://${optionalEnv("VERCEL_URL")}` : undefined) ??
  "http://localhost:3000";

/** Root domain servers get their address under: <subdomain>.<ROOT>. */
export const serverDomain = () => optionalEnv("NEXT_PUBLIC_SERVER_DOMAIN") ?? "pack.host";

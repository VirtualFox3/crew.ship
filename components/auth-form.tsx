"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Server } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signup = mode === "signup";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (signup && !/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      setError("Username must be 3–24 characters: letters, numbers or underscores.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;

        // With email confirmation enabled Supabase returns a user but no session.
        if (!data.session) {
          setNotice("Check your inbox — we sent a confirmation link to finish signup.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function withOAuth(provider: "discord" | "google") {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-5 py-12">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(60%_50%_at_50%_0%,#000,transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 glow-grass" />

      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center bg-grass-500 text-ink-950">
            <Server className="size-5" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Howl<span className="text-grass-400">.Host</span>
          </span>
        </Link>

        <div className="border border-ink-700/70 bg-ink-900/80 p-6 backdrop-blur">
          <h1 className="text-xl font-semibold">
            {signup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            {signup
              ? "Free forever. No card, no ads, no upsell."
              : "Log in to manage your servers."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {signup && (
              <Field label="Username" htmlFor="username" hint="Shown on your servers and invites.">
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="steve"
                  autoComplete="username"
                  required
                />
              </Field>
            )}

            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              hint={signup ? "At least 8 characters." : undefined}
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={signup ? "new-password" : "current-password"}
                required
              />
            </Field>

            {error && <Alert tone="error">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <Button type="submit" className="w-full" loading={loading}>
              {signup ? "Create account" : "Log in"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-ink-500">
            <span className="h-px flex-1 bg-ink-700" />
            or
            <span className="h-px flex-1 bg-ink-700" />
          </div>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => withOAuth("discord")}
              type="button"
            >
              Continue with Discord
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => withOAuth("google")}
              type="button"
            >
              Continue with Google
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-ink-400">
            {signup ? "Already have an account? " : "New here? "}
            <Link
              href={signup ? "/login" : "/signup"}
  className="font-medium text-grass-400 hover:text-grass-300"
            >
              {signup ? "Log in" : "Create one free"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

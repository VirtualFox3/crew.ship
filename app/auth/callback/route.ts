import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Exchanges the OAuth / email-confirmation code for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const providerError = searchParams.get("error_description");

  if (providerError) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "OAuth provider callback failed",
        error: providerError,
      }),
    );
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`,
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/dashboard"}`);
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "OAuth session exchange failed",
        error: exchangeError.message,
        code: exchangeError.code,
        status: exchangeError.status,
      }),
    );
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: "OAuth callback missing authorization code",
    }),
  );
  return NextResponse.redirect(`${origin}/login?error=Could+not+sign+you+in`);
}

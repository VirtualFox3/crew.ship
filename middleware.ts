import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/env";

const PROTECTED = ["/dashboard", "/server", "/account"];

/**
 * Refreshes the Supabase session cookie on every request and gates the panel.
 * Without this, server components would see an expired token after an hour.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // A fresh clone with no Supabase project yet still serves the marketing site.
  if (!isConfigured()) return response;

  const supabase = createServerClient(supabaseUrl()!, supabaseAnonKey()!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && PROTECTED.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the agent-facing API.
    "/((?!_next/static|_next/image|favicon.ico|api/internal|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

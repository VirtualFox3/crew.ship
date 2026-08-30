import { createClient } from "@supabase/supabase-js";

// This is a public browser key, not a service-role secret. Authorization is
// enforced by Supabase Auth and the database's row-level security policies.
export const supabase = createClient(
  "https://uxjhadjkkufpbanmtnzp.supabase.co",
  "sb_publishable_y5IhWW4wnNTNY6L9IxB53g_2YRAp1pD",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  },
);

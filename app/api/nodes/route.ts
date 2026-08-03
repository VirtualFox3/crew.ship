import { z } from "zod";
import { ApiError, handler, ok, readJson, requireUser } from "@/lib/api";
import { nodeSecret } from "@/lib/agent";

export const dynamic = "force-dynamic";

const nodeSchema = z.object({
  name: z.string().trim().min(2).max(40),
  agent_url: z.string().url().refine((value) => /^https:\/\//.test(value), "Agent URL must use HTTPS."),
  public_host: z.string().trim().min(3).max(255),
  region: z.string().trim().min(2).max(40).default("home"),
  max_servers: z.number().int().min(1).max(40).default(4),
  max_memory_mb: z.number().int().min(2048).max(131072).default(8192),
});

export const GET = handler(async () => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("nodes").select("*").order("created_at");
  if (error) throw new ApiError(error.message, 500);
  return ok({ nodes: data ?? [] });
});

export const POST = handler(async (request: Request) => {
  const { user, supabase } = await requireUser();
  const parsed = nodeSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "Invalid host settings.");

  const { data, error } = await supabase
    .from("nodes")
    .insert({ ...parsed.data, owner_id: user.id, status: "offline" })
    .select()
    .single();
  if (error) throw new ApiError(error.message, 500);

  return ok({
    node: data,
    config: {
      NODE_ID: data.id,
      NODE_NAME: data.name,
      AGENT_SHARED_SECRET: nodeSecret(data.id),
      PANEL_URL: new URL(request.url).origin,
    },
  }, 201);
});

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers build config.
 *
 * The panel is dynamic top to bottom — every page reads the signed-in user, so
 * there is nothing worth incremental-cache'ing. Leaving the cache handler unset
 * keeps the worker small and avoids requiring an R2 bucket or KV namespace just
 * to deploy.
 */
export default defineCloudflareConfig();

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createDeleteAccountHandler } from "./core.mjs";

const handler = createDeleteAccountHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  publishableKey: Deno.env.get("SUPABASE_ANON_KEY"),
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  bucket: "ai-document-files"
});

Deno.serve(handler);

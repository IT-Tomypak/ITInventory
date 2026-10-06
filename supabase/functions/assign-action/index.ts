// assign-action — what the /assign page calls. The TOKEN is the authorisation;
// there is no session, so verify_jwt can stay ON (the page sends the anon key)
// and protects nothing either way.
//
// POST { token, choice?, signature?, confirm? }
//   confirm falsy -> preview only. Writes NOTHING: Microsoft 365 Safe Links
//                    opens every link in a message before a human does.
//   confirm true  -> re-validates the token (exists, unused, unexpired),
//                    re-checks eligibility, acts, and burns the token.
// Every check lives in public.assignment_link() so the preview and the press
// cannot disagree; this function exists only because the write needs the
// service role (allocate_asset refuses anon) and to record the caller's IP.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ ok: false, reason: "Bad request." }); }
  const { data, error } = await supabase.rpc("assignment_link", {
    p_token: String(b.token ?? ""),
    p_choice: b.choice == null ? null : String(b.choice),
    p_signature: b.signature == null ? null : String(b.signature),
    p_ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    p_commit: b.confirm === true,
  });
  if (error) return json({ ok: false, reason: "Something went wrong. Please try again, or open the request in ITrack." });
  return json(data);
});

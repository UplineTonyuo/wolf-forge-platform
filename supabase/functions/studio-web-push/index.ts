import { withSupabase } from "npm:@supabase/server@1.9.2";
import webpush from "npm:web-push@3.6.7";
import { dispatchClientPush, dispatchCallPush } from "./handler.ts";

const worker = {
  fetch: withSupabase({ auth: "secret" }, async (request, context) => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
      const result = await dispatchClientPush(
        context.supabaseAdmin.rpc.bind(context.supabaseAdmin),
        webpush.generateRequestDetails.bind(webpush), fetch, Deno.env.get("SUPABASE_URL") ?? "",
      );
      if (Deno.env.get("TICKET_CALL_PUSH_ENABLED") === "1") {
        await dispatchCallPush(context.supabaseAdmin.rpc.bind(context.supabaseAdmin),
          webpush.generateRequestDetails.bind(webpush), fetch, Deno.env.get("SUPABASE_URL") ?? "");
      }
      return Response.json(result, { status: result.refused ? 403 : 200 });
    } catch {
      return Response.json({ error: "Push processing unavailable" }, { status: 503 });
    }
  }),
};

export default worker;

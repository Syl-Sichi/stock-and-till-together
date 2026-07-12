import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/low-stock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apiKey = request.headers.get("apikey");
        if (!expectedKey || apiKey !== expectedKey) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json()) as {
          product_id?: string;
          name?: string;
          quantity?: number;
          min_stock?: number;
        };
        if (!body.product_id || !body.name) return Response.json({ ok: false }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Dedupe: only alert once per product per day
        const ref = `${body.product_id}:${new Date().toISOString().slice(0, 10)}`;
        const { error: dedupeErr } = await supabaseAdmin
          .from("notification_log")
          .insert({ kind: "low_stock", ref });
        if (dedupeErr && !dedupeErr.message.includes("duplicate")) {
          return Response.json({ ok: false, error: dedupeErr.message }, { status: 500 });
        }
        if (dedupeErr) return Response.json({ ok: true, deduped: true });

        const { sendPushToAll } = await import("@/lib/push/send.server");
        const result = await sendPushToAll({
          title: "Low stock alert",
          body: `${body.name} is down to ${body.quantity} (min ${body.min_stock}).`,
          url: "/inventory",
          tag: `low-${body.product_id}`,
        });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});

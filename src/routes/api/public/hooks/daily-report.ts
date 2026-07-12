import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apiKey = request.headers.get("apikey");
        if (!expectedKey || apiKey !== expectedKey) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = new Date().toISOString().slice(0, 10);
        const { error: dedupeErr } = await supabaseAdmin
          .from("notification_log")
          .insert({ kind: "daily_report", ref: today });
        if (dedupeErr && !dedupeErr.message.includes("duplicate")) {
          return Response.json({ ok: false, error: dedupeErr.message }, { status: 500 });
        }
        if (dedupeErr) return Response.json({ ok: true, deduped: true });

        // Compute today's totals (Africa/Lagos day boundary)
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const { data: sales } = await supabaseAdmin
          .from("sales")
          .select("total")
          .gte("created_at", start.toISOString());
        const count = sales?.length ?? 0;
        const total = (sales ?? []).reduce((sum, s) => sum + Number(s.total || 0), 0);
        const fmt = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

        const { sendPushToAll } = await import("@/lib/push/send.server");
        const result = await sendPushToAll({
          title: "Daily report ready",
          body: count === 0
            ? "No sales recorded today."
            : `${count} sales · ${fmt.format(total)} in revenue today.`,
          url: "/reports",
          tag: `daily-${today}`,
        });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});

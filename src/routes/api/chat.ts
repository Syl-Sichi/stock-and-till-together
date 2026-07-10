import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

async function fetchInventoryContext(token: string) {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [products, salesToday, itemsToday, itemsWeek] = await Promise.all([
    supabase
      .from("products")
      .select("name,quantity,min_stock,selling_price,cost_price,archived")
      .eq("archived", false)
      .order("quantity"),
    supabase.from("sales").select("total,payment_method").gte("created_at", startOfDay.toISOString()),
    supabase
      .from("sale_items")
      .select("name_snapshot,qty,unit_price,cost_snapshot")
      .gte("created_at", startOfDay.toISOString()),
    supabase
      .from("sale_items")
      .select("name_snapshot,qty,line_total")
      .gte("created_at", weekAgo.toISOString()),
  ]);

  const revenueToday = salesToday.data?.reduce((a, s) => a + Number(s.total), 0) ?? 0;
  const profitToday =
    itemsToday.data?.reduce(
      (a, i) => a + (Number(i.unit_price) - Number(i.cost_snapshot)) * i.qty,
      0,
    ) ?? 0;

  const low = (products.data ?? []).filter((p) => p.quantity <= p.min_stock);
  const out = (products.data ?? []).filter((p) => p.quantity <= 0);

  const agg = new Map<string, { qty: number; total: number }>();
  itemsWeek.data?.forEach((i) => {
    const cur = agg.get(i.name_snapshot) ?? { qty: 0, total: 0 };
    cur.qty += i.qty;
    cur.total += Number(i.line_total);
    agg.set(i.name_snapshot, cur);
  });
  const topWeek = [...agg.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 10)
    .map(([name, v]) => ({ name, ...v }));

  return {
    revenueToday,
    profitToday,
    txToday: salesToday.data?.length ?? 0,
    inventory: (products.data ?? []).slice(0, 60),
    lowStock: low.map((p) => ({ name: p.name, qty: p.quantity, min: p.min_stock })),
    outOfStock: out.map((p) => p.name),
    topThisWeek: topWeek,
  };
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { messages } = (await request.json()) as { messages: UIMessage[] };

        let context = {};
        try {
          context = await fetchInventoryContext(token);
        } catch (e) {
          console.error("ctx error", e);
        }

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-2.5-flash");

        const system = `You are the My Spot assistant — an AI helper for a small retail shop that uses the My Spot inventory & POS system. Currency is Nigerian Naira (₦).
Answer using the JSON snapshot below. Be concise, use bullet points, and give proactive advice (what to reorder, sales trends, low stock warnings). If asked something not in the snapshot, say so.

STORE SNAPSHOT:
${JSON.stringify(context, null, 2)}`;

        const result = streamText({
          model,
          system,
          messages: convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});

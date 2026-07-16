import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { z } from "zod";

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

function authedClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

function startOfDay(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildShopTools(token: string) {
  const supabase = authedClient(token);
  return {
    findProductStock: tool({
      description:
        "Look up current stock for one product by name, SKU, or barcode. Use this before answering whether a specific item is left, low, or finished.",
      inputSchema: z.object({
        search: z.string().describe("Product name, SKU, barcode, or partial search text"),
      }),
      execute: async ({ search }) => {
        const { data, error } = await supabase
          .from("products")
          .select("id,name,sku,barcode,quantity,min_stock,selling_price,cost_price,updated_at,archived")
          .order("quantity")
          .limit(200);
        if (error) throw new Error(error.message);
        const term = search.trim().toLowerCase();
        return (data ?? [])
          .filter((p) =>
            [p.name, p.sku, p.barcode].some((value) => value?.toLowerCase().includes(term)),
          )
          .slice(0, 12)
          .map((p) => ({
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            quantity: Number(p.quantity),
            min_stock: Number(p.min_stock),
            status:
              Number(p.quantity) <= 0
                ? "out_of_stock"
                : Number(p.quantity) <= Number(p.min_stock)
                  ? "low_stock"
                  : "in_stock",
            selling_price: Number(p.selling_price),
            cost_price: Number(p.cost_price),
            updated_at: p.updated_at,
            archived: p.archived,
          }));
      },
    }),
    listLowStock: tool({
      description: "List products that are low or out of stock right now.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("products")
          .select("name,quantity,min_stock,selling_price,cost_price,updated_at")
          .eq("archived", false)
          .order("quantity")
          .limit(50);
        if (error) throw new Error(error.message);
        return (data ?? [])
          .filter((p) => Number(p.quantity) <= Number(p.min_stock))
          .map((p) => ({
            name: p.name,
            quantity: Number(p.quantity),
            min_stock: Number(p.min_stock),
            status: Number(p.quantity) <= 0 ? "out_of_stock" : "low_stock",
            selling_price: Number(p.selling_price),
            cost_price: Number(p.cost_price),
            updated_at: p.updated_at,
          }));
      },
    }),
    salesSummary: tool({
      description:
        "Summarize revenue, profit, transaction count, and best-selling products for today or the last 7 days.",
      inputSchema: z.object({
        period: z.enum(["today", "week"]).describe("Use today for daily questions, week for weekly trends"),
      }),
      execute: async ({ period }) => {
        const start = period === "week" ? startOfDay(6) : startOfDay(0);
        const [sales, items] = await Promise.all([
          supabase
            .from("sales")
            .select("total,payment_method,created_at")
            .gte("created_at", start.toISOString()),
          supabase
            .from("sale_items")
            .select("name_snapshot,qty,unit_price,cost_snapshot,line_total,created_at")
            .gte("created_at", start.toISOString()),
        ]);
        if (sales.error) throw new Error(sales.error.message);
        if (items.error) throw new Error(items.error.message);

        const revenue = sales.data?.reduce((a, s) => a + Number(s.total), 0) ?? 0;
        const profit =
          items.data?.reduce(
            (a, i) => a + (Number(i.unit_price) - Number(i.cost_snapshot)) * Number(i.qty),
            0,
          ) ?? 0;
        const byProduct = new Map<string, { qty: number; total: number }>();
        items.data?.forEach((i) => {
          const cur = byProduct.get(i.name_snapshot) ?? { qty: 0, total: 0 };
          cur.qty += Number(i.qty);
          cur.total += Number(i.line_total);
          byProduct.set(i.name_snapshot, cur);
        });
        return {
          period,
          revenue,
          profit,
          transactions: sales.data?.length ?? 0,
          items_sold: items.data?.reduce((a, i) => a + Number(i.qty), 0) ?? 0,
          top_products: [...byProduct.entries()]
            .sort((a, b) => b[1].qty - a[1].qty)
            .slice(0, 10)
            .map(([name, value]) => ({ name, ...value })),
        };
      },
    }),
    reorderAdvice: tool({
      description:
        "Give reorder candidates using current stock and recent sales speed. Use when asked what to buy, restock, or prioritize.",
      inputSchema: z.object({}),
      execute: async () => {
        const weekAgo = startOfDay(6);
        const [products, items] = await Promise.all([
          supabase
            .from("products")
            .select("id,name,quantity,min_stock,selling_price,cost_price,archived")
            .eq("archived", false),
          supabase
            .from("sale_items")
            .select("product_id,name_snapshot,qty,line_total")
            .gte("created_at", weekAgo.toISOString()),
        ]);
        if (products.error) throw new Error(products.error.message);
        if (items.error) throw new Error(items.error.message);

        const soldById = new Map<string, number>();
        items.data?.forEach((i) => {
          if (!i.product_id) return;
          soldById.set(i.product_id, (soldById.get(i.product_id) ?? 0) + Number(i.qty));
        });

        return (products.data ?? [])
          .map((p) => {
            const weeklySold = soldById.get(p.id) ?? 0;
            const dailyRate = weeklySold / 7;
            const quantity = Number(p.quantity);
            const minStock = Number(p.min_stock);
            const daysLeft = dailyRate > 0 ? quantity / dailyRate : null;
            const suggestedQty = Math.max(0, Math.ceil(Math.max(minStock * 2, weeklySold) - quantity));
            return {
              name: p.name,
              quantity,
              min_stock: minStock,
              weekly_sold: weeklySold,
              estimated_days_left: daysLeft === null ? null : Number(daysLeft.toFixed(1)),
              suggested_reorder_qty: suggestedQty,
              priority:
                quantity <= 0
                  ? "urgent"
                  : quantity <= minStock
                    ? "high"
                    : daysLeft !== null && daysLeft <= 3
                      ? "high"
                      : weeklySold > 0 && suggestedQty > 0
                        ? "medium"
                        : "low",
            };
          })
          .filter((p) => p.priority !== "low")
          .sort((a, b) => {
            const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
            return rank[a.priority] - rank[b.priority] || b.weekly_sold - a.weekly_sold;
          })
          .slice(0, 20);
      },
    }),
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
        const model = gateway("google/gemini-3-flash-preview");

        const system = `You are the My Spot assistant — an AI helper for a small retail shop that uses the My Spot inventory & POS system. Currency is Nigerian Naira (₦).
Use your shop-data tools before answering questions about stock, low-stock alerts, sales, revenue, profit, best sellers, and what to reorder. Be direct and practical.
When a product is low or finished, use urgent wording: "red alert", "restock now", and state exactly how many are left. If a user asks about a specific product such as Akara, call findProductStock first.
Keep answers concise, with bullets and clear next actions. If the data is missing, say exactly what is missing.

STORE SNAPSHOT:
${JSON.stringify(context, null, 2)}`;

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(messages),
          tools: buildShopTools(token),
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});

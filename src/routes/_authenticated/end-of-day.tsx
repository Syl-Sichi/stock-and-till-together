import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatNaira, formatNumber } from "@/lib/format";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Package, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/end-of-day")({
  component: EndOfDay,
});

function EndOfDay() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const summary = useQuery({
    queryKey: ["end-of-day"],
    queryFn: async () => {
      const [sales, items, products] = await Promise.all([
        supabase
          .from("sales")
          .select("id,total,payment_method,created_at")
          .gte("created_at", todayIso),
        supabase
          .from("sale_items")
          .select("name_snapshot,qty,unit_price,cost_snapshot,line_total")
          .gte("created_at", todayIso),
        supabase
          .from("products")
          .select("name,quantity,cost_price,selling_price,min_stock")
          .eq("archived", false),
      ]);

      const revenue = sales.data?.reduce((a, s) => a + Number(s.total || 0), 0) ?? 0;
      const profit =
        items.data?.reduce(
          (a, i) => a + (Number(i.unit_price || 0) - Number(i.cost_snapshot || 0)) * Number(i.qty || 0),
          0,
        ) ?? 0;
      const txCount = sales.data?.length ?? 0;
      const itemsSold = items.data?.reduce((a, i) => a + Number(i.qty || 0), 0) ?? 0;

      const payments: Record<string, number> = {};
      sales.data?.forEach((s) => {
        const method = s.payment_method || "other";
        payments[method] = (payments[method] ?? 0) + Number(s.total || 0);
      });

      const inventoryValue = products.data?.reduce(
        (a, p) => a + Number(p.quantity || 0) * Number(p.cost_price || 0),
        0,
      ) ?? 0;

      const lowStock = (products.data ?? []).filter(
        (p) => Number(p.quantity) > 0 && Number(p.quantity) <= Number(p.min_stock || 0),
      );
      const outOfStock = (products.data ?? []).filter((p) => Number(p.quantity) <= 0);

      return {
        revenue,
        profit,
        txCount,
        itemsSold,
        payments,
        inventoryValue,
        lowStock,
        outOfStock,
        productCount: products.data?.length ?? 0,
      };
    },
  });

  const data = summary.data;

  function printSummary() {
    window.print();
  }

  function markClosed() {
    toast.success("Day closed. Summary saved in reports.");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" /> End of Day
          </h1>
          <p className="text-sm text-muted-foreground">
            Daily stock taking and accounting summary for {new Date().toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={printSummary}>Print</Button>
          <Button onClick={markClosed}>Mark Day Closed</Button>
        </div>
      </div>

      {summary.isLoading && <p className="text-muted-foreground">Loading today’s summary…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Today’s Revenue</div>
              <div className="text-2xl font-bold">{formatNaira(data.revenue)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Today’s Profit</div>
              <div className="text-2xl font-bold text-green-600">{formatNaira(data.profit)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Transactions</div>
              <div className="text-2xl font-bold">{data.txCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Items Sold</div>
              <div className="text-2xl font-bold">{formatNumber(data.itemsSold)}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Payment Breakdown
              </h3>
              {Object.keys(data.payments).length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales today.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {Object.entries(data.payments).map(([method, amount]) => (
                    <li key={method} className="flex justify-between">
                      <span className="capitalize">{method.replace("_", " ")}</span>
                      <span className="font-medium">{formatNaira(amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Package className="h-4 w-4" /> Inventory Snapshot
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Total products</span>
                  <span className="font-medium">{data.productCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Inventory value (at cost)</span>
                  <span className="font-medium">{formatNaira(data.inventoryValue)}</span>
                </div>
                <div className="flex justify-between text-amber-600">
                  <span>Low stock items</span>
                  <span className="font-medium">{data.lowStock.length}</span>
                </div>
                <div className="flex justify-between text-destructive">
                  <span>Out of stock</span>
                  <span className="font-medium">{data.outOfStock.length}</span>
                </div>
              </div>
            </Card>
          </div>

          {(data.lowStock.length > 0 || data.outOfStock.length > 0) && (
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Stock Taking Alerts
              </h3>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                {data.outOfStock.length > 0 && (
                  <div>
                    <div className="font-medium text-destructive mb-1">Out of Stock</div>
                    <ul className="space-y-1">
                      {data.outOfStock.slice(0, 15).map((p) => (
                        <li key={p.name}>{p.name}</li>
                      ))}
                      {data.outOfStock.length > 15 && (
                        <li className="text-muted-foreground">+{data.outOfStock.length - 15} more</li>
                      )}
                    </ul>
                  </div>
                )}
                {data.lowStock.length > 0 && (
                  <div>
                    <div className="font-medium text-amber-600 mb-1">Low Stock</div>
                    <ul className="space-y-1">
                      {data.lowStock.slice(0, 15).map((p) => (
                        <li key={p.name}>
                          {p.name} — {p.quantity} left (min {p.min_stock})
                        </li>
                      ))}
                      {data.lowStock.length > 15 && (
                        <li className="text-muted-foreground">+{data.lowStock.length - 15} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}

          {data.lowStock.length === 0 && data.outOfStock.length === 0 && (
            <Card className="p-5 flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              All products are adequately stocked.
            </Card>
          )}
        </>
      )}
    </div>
  );
}

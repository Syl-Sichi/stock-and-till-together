import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatNaira, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Download } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/reports")({
  component: Reports,
});

type Period = "day" | "week" | "month";

function sinceFor(period: Period): Date {
  const d = new Date();
  if (period === "day") d.setHours(0, 0, 0, 0);
  else if (period === "week") d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d;
}

function Reports() {
  const [period, setPeriod] = useState<Period>("day");
  const since = sinceFor(period).toISOString();

  const report = useQuery({
    queryKey: ["reports", period],
    queryFn: async () => {
      const [sales, items] = await Promise.all([
        supabase.from("sales").select("id,total,payment_method,created_at").gte("created_at", since),
        supabase
          .from("sale_items")
          .select("name_snapshot,qty,unit_price,cost_snapshot,line_total,created_at")
          .gte("created_at", since),
      ]);
      const revenue = sales.data?.reduce((a, s) => a + Number(s.total), 0) ?? 0;
      const profit =
        items.data?.reduce(
          (a, i) => a + (Number(i.unit_price) - Number(i.cost_snapshot)) * i.qty,
          0,
        ) ?? 0;
      const txCount = sales.data?.length ?? 0;
      const itemsSold = items.data?.reduce((a, i) => a + i.qty, 0) ?? 0;
      const payments = { cash: 0, transfer: 0, card: 0 } as Record<string, number>;
      sales.data?.forEach((s) => {
        payments[s.payment_method] = (payments[s.payment_method] ?? 0) + Number(s.total);
      });

      const agg = new Map<string, { name: string; qty: number; total: number }>();
      items.data?.forEach((i) => {
        const cur = agg.get(i.name_snapshot) ?? { name: i.name_snapshot, qty: 0, total: 0 };
        cur.qty += i.qty;
        cur.total += Number(i.line_total);
        agg.set(i.name_snapshot, cur);
      });
      const rows = Array.from(agg.values()).sort((a, b) => b.total - a.total);

      return { revenue, profit, txCount, itemsSold, payments, rows };
    },
  });

  function exportCsv() {
    const rows = report.data?.rows ?? [];
    const header = "Product,Quantity,Total\n";
    const body = rows.map((r) => `"${r.name}",${r.qty},${r.total}`).join("\n");
    const csv = header + body;
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `my-spot-report-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="day">Today</TabsTrigger>
            <TabsTrigger value="week">Last 7 days</TabsTrigger>
            <TabsTrigger value="month">Last 30 days</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Revenue" value={formatNaira(report.data?.revenue ?? 0)} />
        <Stat label="Profit" value={formatNaira(report.data?.profit ?? 0)} accent />
        <Stat label="Transactions" value={formatNumber(report.data?.txCount ?? 0)} />
        <Stat label="Items sold" value={formatNumber(report.data?.itemsSold ?? 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold mb-4">Top products</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(report.data?.rows ?? []).slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v: number) => formatNaira(v)}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }}
                />
                <Bar dataKey="total" fill="var(--primary)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold">Payment breakdown</h3>
          <div className="mt-4 space-y-3 text-sm">
            {Object.entries(report.data?.payments ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="capitalize text-muted-foreground">{k}</span>
                <span className="font-medium">{formatNaira(v)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3 text-right">Quantity</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(report.data?.rows ?? []).map((r) => (
                <tr key={r.name} className="border-t">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 text-right">{formatNumber(r.qty)}</td>
                  <td className="p-3 text-right font-medium">{formatNaira(r.total)}</td>
                </tr>
              ))}
              {(report.data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-muted-foreground">
                    No sales in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={`p-5 ${accent ? "bg-primary text-primary-foreground" : ""}`}>
      <div
        className={`text-xs uppercase tracking-wide ${
          accent ? "opacity-80" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
      <div className="text-2xl font-display font-bold mt-2">{value}</div>
    </Card>
  );
}

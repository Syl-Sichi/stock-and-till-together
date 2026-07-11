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
  LineChart,
  Line,
} from "recharts";
import { Download, FileText } from "lucide-react";
import { useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";
import { generateReportPdf } from "@/lib/pdf-report";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  component: Reports,
});

type Period = "day" | "week" | "month";

function rangeFor(period: Period): { since: Date; until: Date } {
  const until = new Date();
  const since = new Date();
  if (period === "day") since.setHours(0, 0, 0, 0);
  else if (period === "week") since.setDate(since.getDate() - 6);
  else since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);
  return { since, until };
}

function Reports() {
  const [period, setPeriod] = useState<Period>("day");
  const { since, until } = rangeFor(period);
  const sinceIso = since.toISOString();
  const { data: settings } = useSettings();
  const topChartRef = useRef<HTMLDivElement>(null);
  const trendChartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const report = useQuery({
    queryKey: ["reports", period],
    queryFn: async () => {
      const [sales, items, lowStock] = await Promise.all([
        supabase
          .from("sales")
          .select("id,total,payment_method,created_at")
          .gte("created_at", sinceIso),
        supabase
          .from("sale_items")
          .select("name_snapshot,qty,unit_price,cost_snapshot,line_total,created_at")
          .gte("created_at", sinceIso),
        supabase
          .from("products")
          .select("name,quantity,min_stock")
          .eq("archived", false)
          .order("quantity"),
      ]);
      const revenue = sales.data?.reduce((a, s) => a + Number(s.total), 0) ?? 0;
      const profit =
        items.data?.reduce(
          (a, i) => a + (Number(i.unit_price) - Number(i.cost_snapshot)) * i.qty,
          0,
        ) ?? 0;
      const txCount = sales.data?.length ?? 0;
      const itemsSold = items.data?.reduce((a, i) => a + i.qty, 0) ?? 0;
      const payments: Record<string, number> = {};
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

      // Daily breakdown
      const dailyMap = new Map<string, { revenue: number; profit: number; tx: number }>();
      const days = period === "day" ? 1 : period === "week" ? 7 : 30;
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        dailyMap.set(d.toISOString().slice(0, 10), { revenue: 0, profit: 0, tx: 0 });
      }
      sales.data?.forEach((s) => {
        const k = new Date(s.created_at).toISOString().slice(0, 10);
        const cur = dailyMap.get(k);
        if (cur) {
          cur.revenue += Number(s.total);
          cur.tx += 1;
        }
      });
      items.data?.forEach((i) => {
        const k = new Date(i.created_at).toISOString().slice(0, 10);
        const cur = dailyMap.get(k);
        if (cur) cur.profit += (Number(i.unit_price) - Number(i.cost_snapshot)) * i.qty;
      });
      const daily = Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const low =
        lowStock.data
          ?.filter((p) => p.quantity <= p.min_stock)
          .slice(0, 20)
          .map((p) => ({ name: p.name, quantity: p.quantity, min_stock: p.min_stock })) ?? [];

      return { revenue, profit, txCount, itemsSold, payments, rows, daily, lowStock: low };
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

  async function exportPdf() {
    if (!report.data) return;
    setExporting(true);
    try {
      const charts = [trendChartRef.current, topChartRef.current].filter(
        (el): el is HTMLDivElement => !!el,
      );
      await generateReportPdf(
        {
          period,
          storeName: settings?.store_name ?? "My Spot",
          since,
          until,
          revenue: report.data.revenue,
          profit: report.data.profit,
          txCount: report.data.txCount,
          itemsSold: report.data.itemsSold,
          payments: report.data.payments,
          rows: report.data.rows,
          daily: report.data.daily,
          lowStock: report.data.lowStock,
        },
        charts,
      );
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  const trend = report.data?.daily ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="day">Today</TabsTrigger>
            <TabsTrigger value="week">Weekly</TabsTrigger>
            <TabsTrigger value="month">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button onClick={exportPdf} disabled={exporting || !report.data}>
            <FileText className="h-4 w-4 mr-1" /> {exporting ? "Generating…" : "Export PDF"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Revenue" value={formatNaira(report.data?.revenue ?? 0)} />
        <Stat label="Profit" value={formatNaira(report.data?.profit ?? 0)} accent />
        <Stat label="Transactions" value={formatNumber(report.data?.txCount ?? 0)} />
        <Stat label="Items sold" value={formatNumber(report.data?.itemsSold ?? 0)} />
      </div>

      {period !== "day" && (
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Revenue & profit trend</h3>
          <div ref={trendChartRef} className="h-64 bg-card">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v: number) => formatNaira(v)}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }}
                />
                <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold mb-4">Top products</h3>
          <div ref={topChartRef} className="h-64 bg-card">
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
            {Object.keys(report.data?.payments ?? {}).length === 0 && (
              <div className="text-muted-foreground">No sales in this period.</div>
            )}
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

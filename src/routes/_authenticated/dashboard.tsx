import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatNaira, formatNumber } from "@/lib/format";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { AlertTriangle, PackageX, Receipt, TrendingUp, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function Dashboard() {
  const today = useQuery({
    queryKey: ["dash", "today"],
    queryFn: async () => {
      const since = startOfToday();
      const [sales, items] = await Promise.all([
        supabase.from("sales").select("id,total").gte("created_at", since),
        supabase
          .from("sale_items")
          .select("qty,line_total,cost_snapshot,unit_price,sale_id,created_at")
          .gte("created_at", since),
      ]);
      const revenue = sales.data?.reduce((a, s) => a + Number(s.total), 0) ?? 0;
      const txCount = sales.data?.length ?? 0;
      const itemsSold = items.data?.reduce((a, i) => a + i.qty, 0) ?? 0;
      const profit =
        items.data?.reduce((a, i) => a + (Number(i.unit_price) - Number(i.cost_snapshot)) * i.qty, 0) ?? 0;
      return { revenue, txCount, itemsSold, profit };
    },
  });

  const inv = useQuery({
    queryKey: ["dash", "inventory"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,quantity,min_stock,cost_price,selling_price,archived")
        .eq("archived", false);
      const value =
        data?.reduce((a, p) => a + Number(p.cost_price) * Number(p.quantity), 0) ?? 0;
      const low = data?.filter((p) => p.quantity > 0 && p.quantity <= p.min_stock) ?? [];
      const out = data?.filter((p) => p.quantity <= 0) ?? [];
      return { value, low, out, count: data?.length ?? 0 };
    },
  });

  const weekly = useQuery({
    queryKey: ["dash", "weekly"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 13);
      since.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("sales")
        .select("total,created_at")
        .gte("created_at", since.toISOString());
      const buckets: Record<string, number> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        buckets[d.toISOString().slice(0, 10)] = 0;
      }
      data?.forEach((s) => {
        const k = s.created_at.slice(0, 10);
        if (k in buckets) buckets[k] += Number(s.total);
      });
      return Object.entries(buckets).map(([date, revenue]) => ({
        date: date.slice(5),
        revenue,
      }));
    },
  });

  const top = useQuery({
    queryKey: ["dash", "top"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sale_items")
        .select("name_snapshot,qty,line_total")
        .order("created_at", { ascending: false })
        .limit(500);
      const agg = new Map<string, { name: string; qty: number; total: number }>();
      data?.forEach((i) => {
        const cur = agg.get(i.name_snapshot) ?? { name: i.name_snapshot, qty: 0, total: 0 };
        cur.qty += i.qty;
        cur.total += Number(i.line_total);
        agg.set(i.name_snapshot, cur);
      });
      return Array.from(agg.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Today's Revenue"
          value={formatNaira(today.data?.revenue ?? 0)}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="Today's Profit"
          value={formatNaira(today.data?.profit ?? 0)}
          icon={<TrendingUp className="h-5 w-5" />}
          accent
        />
        <StatCard
          label="Transactions"
          value={formatNumber(today.data?.txCount ?? 0)}
          icon={<Receipt className="h-5 w-5" />}
        />
        <StatCard
          label="Items Sold"
          value={formatNumber(today.data?.itemsSold ?? 0)}
          icon={<Receipt className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Revenue — last 14 days</h3>
            <span className="text-xs text-muted-foreground">₦</span>
          </div>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  formatter={(v: number) => formatNaira(v)}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }}
                />
                <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold">Inventory value</h3>
          <p className="text-3xl font-display font-bold mt-2">
            {formatNaira(inv.data?.value ?? 0)}
          </p>
          <p className="text-sm text-muted-foreground">Across {inv.data?.count ?? 0} products</p>

          <div className="mt-4 space-y-2">
            <Alert
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Low stock"
              value={inv.data?.low.length ?? 0}
              tone="warning"
            />
            <Alert
              icon={<PackageX className="h-4 w-4" />}
              label="Out of stock"
              value={inv.data?.out.length ?? 0}
              tone="destructive"
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold">Best sellers (recent)</h3>
          <div className="mt-4 space-y-3">
            {(top.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            )}
            {top.data?.map((t) => (
              <div key={t.name} className="flex items-center justify-between text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground">
                  {formatNumber(t.qty)} sold · {formatNaira(t.total)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold">Low-stock products</h3>
          <div className="mt-4 space-y-2 max-h-64 overflow-auto">
            {(inv.data?.low ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">All good — no low-stock items.</p>
            )}
            {inv.data?.low.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span>{p.name}</span>
                <span className="text-warning-foreground bg-warning/30 px-2 py-0.5 rounded-full text-xs">
                  {p.quantity} left
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={`p-5 ${accent ? "bg-primary text-primary-foreground" : ""}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs uppercase tracking-wide ${accent ? "opacity-80" : "text-muted-foreground"}`}>
          {label}
        </span>
        <span className={accent ? "opacity-90" : "text-muted-foreground"}>{icon}</span>
      </div>
      <div className="text-2xl font-display font-bold mt-2">{value}</div>
    </Card>
  );
}

function Alert({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "warning" | "destructive";
}) {
  const cls =
    tone === "warning"
      ? "bg-warning/20 text-warning-foreground"
      : "bg-destructive/15 text-destructive";
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${cls}`}>
      <span className="flex items-center gap-2 text-sm">
        {icon} {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

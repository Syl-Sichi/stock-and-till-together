import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatDate, formatNaira } from "@/lib/format";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sales")({
  component: Sales,
});

function Sales() {
  const [q, setQ] = useState("");
  const sales = useQuery({
    queryKey: ["sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,total,payment_method,created_at, sale_items(qty,name_snapshot,line_total)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const filtered = (sales.data ?? []).filter(
    (s) =>
      !q ||
      s.id.includes(q) ||
      s.sale_items?.some((i) => i.name_snapshot.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by transaction ID or product…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Transaction</th>
                <th className="p-3">Items</th>
                <th className="p-3">Payment</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-mono text-xs">{s.id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(s.created_at)}</div>
                  </td>
                  <td className="p-3">
                    <div className="text-xs">
                      {s.sale_items?.map((i, idx) => (
                        <div key={idx}>
                          {i.qty} × {i.name_snapshot}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 capitalize">{s.payment_method}</td>
                  <td className="p-3 text-right font-medium">{formatNaira(s.total)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    No sales yet.
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

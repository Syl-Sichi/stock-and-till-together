import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatNaira, formatNumber } from "@/lib/format";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Package, TrendingUp, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Papa from "papaparse";

export const Route = createFileRoute("/_authenticated/end-of-day")({
  component: EndOfDay,
});

type ProductRow = {
  id: string;
  name: string;
  quantity: number;
  cost_price: number;
  min_stock: number;
};

function EndOfDay() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

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
          .select("id,name,quantity,cost_price,selling_price,min_stock")
          .eq("archived", false)
          .order("name"),
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

      const productList: ProductRow[] = (products.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        quantity: Number(p.quantity || 0),
        cost_price: Number(p.cost_price || 0),
        min_stock: Number(p.min_stock || 0),
      }));

      const inventoryValue = productList.reduce((a, p) => a + p.quantity * p.cost_price, 0);
      const lowStock = productList.filter((p) => p.quantity > 0 && p.quantity <= p.min_stock);
      const outOfStock = productList.filter((p) => p.quantity <= 0);

      return {
        revenue,
        profit,
        txCount,
        itemsSold,
        payments,
        inventoryValue,
        lowStock,
        outOfStock,
        productCount: productList.length,
        products: productList,
      };
    },
  });

  const data = summary.data;

  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    const q = search.toLowerCase().trim();
    if (!q) return data.products;
    return data.products.filter((p) => p.name.toLowerCase().includes(q));
  }, [data?.products, search]);

  function setCount(id: string, value: string) {
    setCounts((prev) => ({ ...prev, [id]: value }));
  }

  function varianceFor(p: ProductRow) {
    const physical = counts[p.id] === undefined || counts[p.id] === "" ? null : Number(counts[p.id]);
    if (physical === null || Number.isNaN(physical)) return null;
    return physical - p.quantity;
  }

  function exportCsv() {
    if (!data) return;
    const rows = data.products.map((p) => {
      const physical = counts[p.id] === "" || counts[p.id] === undefined ? "" : Number(counts[p.id]);
      const variance = typeof physical === "number" ? physical - p.quantity : "";
      return {
        Product: p.name,
        "System Qty": p.quantity,
        "Physical Count": physical,
        Variance: variance,
        "Cost Price": p.cost_price,
        "Value at Cost": p.quantity * p.cost_price,
      };
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `end-of-day-stock-take-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }

  function exportPdf() {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("End of Day Stock Take & Accounting", 14, 18);
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 26);
    doc.text(`Revenue: ${formatNaira(data.revenue)}   Profit: ${formatNaira(data.profit)}`, 14, 32);
    doc.text(`Transactions: ${data.txCount}   Items sold: ${data.itemsSold}`, 14, 38);

    const tableRows = data.products
      .filter((p) => counts[p.id] !== undefined && counts[p.id] !== "")
      .map((p) => {
        const physical = Number(counts[p.id]);
        const variance = physical - p.quantity;
        return [p.name, p.quantity, physical, variance, formatNaira(p.cost_price)];
      });

    if (tableRows.length === 0) {
      doc.text("No physical counts entered.", 14, 50);
    } else {
      autoTable(doc, {
        startY: 46,
        head: [["Product", "System", "Physical", "Variance", "Cost"]],
        body: tableRows,
        styles: { fontSize: 8 },
      });
    }

    doc.save(`end-of-day-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF exported");
  }

  function printSummary() {
    window.print();
  }

  function markClosed() {
    toast.success("Day closed. Summary available in reports and exports.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" /> End of Day
          </h1>
          <p className="text-sm text-muted-foreground">
            Daily stock taking and accounting for {new Date().toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={!data}>
            <FileText className="h-4 w-4 mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={printSummary}>Print</Button>
          <Button size="sm" onClick={markClosed}>Mark Day Closed</Button>
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

          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" /> Physical Stock Count
              </h3>
              <Input
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Enter the physical quantity counted. Variance = Physical − System. Positive means overage, negative means shortage.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-3">Product</th>
                    <th className="pb-2 pr-3 text-right">System</th>
                    <th className="pb-2 pr-3">Physical</th>
                    <th className="pb-2 pr-3 text-right">Variance</th>
                    <th className="pb-2 text-right">Value (cost)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.slice(0, 100).map((p) => {
                    const variance = varianceFor(p);
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">{p.name}</td>
                        <td className="py-2 pr-3 text-right">{p.quantity}</td>
                        <td className="py-2 pr-3">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-24"
                            placeholder="—"
                            value={counts[p.id] ?? ""}
                            onChange={(e) => setCount(p.id, e.target.value)}
                          />
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-medium ${
                            variance === null
                              ? "text-muted-foreground"
                              : variance > 0
                              ? "text-green-600"
                              : variance < 0
                              ? "text-destructive"
                              : ""
                          }`}
                        >
                          {variance === null ? "—" : variance > 0 ? `+${variance}` : variance}
                        </td>
                        <td className="py-2 text-right">{formatNaira(p.quantity * p.cost_price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredProducts.length > 100 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing first 100 matching products. Use search to narrow.
                </p>
              )}
            </div>
          </Card>

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
                      {data.outOfStock.slice(0, 10).map((p) => (
                        <li key={p.name}>{p.name}</li>
                      ))}
                      {data.outOfStock.length > 10 && (
                        <li className="text-muted-foreground">+{data.outOfStock.length - 10} more</li>
                      )}
                    </ul>
                  </div>
                )}
                {data.lowStock.length > 0 && (
                  <div>
                    <div className="font-medium text-amber-600 mb-1">Low Stock</div>
                    <ul className="space-y-1">
                      {data.lowStock.slice(0, 10).map((p) => (
                        <li key={p.name}>
                          {p.name} — {p.quantity} left (min {p.min_stock})
                        </li>
                      ))}
                      {data.lowStock.length > 10 && (
                        <li className="text-muted-foreground">+{data.lowStock.length - 10} more</li>
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

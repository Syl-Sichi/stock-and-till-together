import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNaira } from "@/lib/format";
import { AlertTriangle, CheckCircle2, Minus, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { bulkPutSnapshot, enqueue, getSnapshot, listSnapshot, putSnapshot } from "@/lib/offline/db";
import { emitChange, isOnline } from "@/lib/offline/network";
import { runSync } from "@/lib/offline/sync";
import { PendingSalesButton } from "@/components/PendingSalesPanel";

export const Route = createFileRoute("/_authenticated/pos")({
  component: POS,
});

type Product = {
  id: string;
  name: string;
  barcode: string | null;
  selling_price: number;
  cost_price: number;
  quantity: number;
  min_stock: number;
};

type CartLine = { product: Product; qty: number };
type StockNoticeLine = {
  product_id: string;
  name: string;
  sold: number;
  remaining: number;
  min: number;
  level: "normal" | "low" | "out";
};

function POS() {
  const qc = useQueryClient();
  const settings = useSettings();
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [payment, setPayment] = useState("cash");
  const [cashReceived, setCashReceived] = useState<number | "">("");
  const [lastSaleNotice, setLastSaleNotice] = useState<{
    offline: boolean;
    lines: StockNoticeLine[];
  } | null>(null);
  const [sessionStock, setSessionStock] = useState<StockNoticeLine[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  const products = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,barcode,selling_price,cost_price,quantity,min_stock")
        .eq("archived", false)
        .order("name");
      if (!error && data) {
        await bulkPutSnapshot("products", data as Array<{ id: string } & Record<string, unknown>>);
        return data as Product[];
      }
      if (!isOnline()) return listSnapshot<Product>("products");
      throw error ?? new Error("Could not load products");
    },
  });

  const filtered = useMemo(() => {
    const list = products.data ?? [];
    if (!q) return list.slice(0, 30);
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.barcode?.toLowerCase().includes(q.toLowerCase()),
      )
      .slice(0, 30);
  }, [q, products.data]);

  function add(product: Product) {
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id);
      if (existing)
        return c.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { product, qty: 1 }];
    });
    setQ("");
  }

  function scanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    const match = (products.data ?? []).find(
      (p) => p.barcode === q || p.name.toLowerCase() === q.toLowerCase(),
    );
    if (match) add(match);
    else toast.error("No product matches that code");
  }

  const subtotal = cart.reduce((a, l) => a + Number(l.product.selling_price) * l.qty, 0);
  const discount = (subtotal * discountPct) / 100;
  const taxRate = Number(settings.data?.tax_rate ?? 0);
  const tax = ((subtotal - discount) * taxRate) / 100;
  const total = Math.max(0, subtotal - discount + tax);
  const change =
    payment === "cash" && typeof cashReceived === "number" ? Math.max(0, cashReceived - total) : 0;

  const checkout = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Cart is empty");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      const client_ref = crypto.randomUUID();
      const items = cart.map((l) => ({
        product_id: l.product.id,
        name_snapshot: l.product.name,
        qty: l.qty,
        unit_price: Number(l.product.selling_price),
        cost_snapshot: Number(l.product.cost_price),
        line_total: Number(l.product.selling_price) * l.qty,
      }));
      const salePayload = {
        client_ref,
        cashier_id: uid,
        subtotal,
        discount,
        tax,
        total,
        payment_method: payment,
        cash_received: payment === "cash" && typeof cashReceived === "number" ? cashReceived : null,
      };
      const threshold = Number(settings.data?.low_stock_threshold ?? 0);
      const localStock = new Map<string, { quantity: number; min_stock: number; name: string }>();

      // Optimistically decrement local product snapshots so UI stays correct offline
      for (const it of items) {
        const product = cart.find((l) => l.product.id === it.product_id)?.product;
        const cur = await getSnapshot<{
          id: string;
          quantity: number;
          min_stock?: number;
          name?: string;
        }>("products", it.product_id);
        const base = cur ?? product;
        if (base) {
          const quantity = Math.max(0, Number(base.quantity) - it.qty);
          const min_stock = Number(base.min_stock ?? product?.min_stock ?? threshold);
          const name = String(base.name ?? product?.name ?? it.name_snapshot);
          await putSnapshot("products", { ...base, id: it.product_id, quantity, min_stock, name });
          localStock.set(it.product_id, { quantity, min_stock, name });
        }
      }

      if (isOnline()) {
        try {
          const { data: sale, error } = await supabase
            .from("sales")
            .upsert({ ...salePayload }, { onConflict: "client_ref" })
            .select("*")
            .single();
          if (error) throw error;
          const { error: e2 } = await supabase
            .from("sale_items")
            .insert(items.map((it) => ({ ...it, sale_id: sale.id })));
          if (e2) throw e2;
          const ids = [...new Set(items.map((it) => it.product_id))];
          const { data: updatedProducts } = await supabase
            .from("products")
            .select("id,name,quantity,min_stock")
            .in("id", ids);
          const updatedById = new Map(
            (updatedProducts ?? []).map((p) => [
              p.id,
              {
                quantity: Number(p.quantity),
                min_stock: Number(p.min_stock),
                name: p.name,
              },
            ]),
          );
          for (const p of updatedProducts ?? []) {
            const product = cart.find((l) => l.product.id === p.id)?.product;
            await putSnapshot("products", { ...(product ?? {}), ...p, id: p.id });
          }
          return {
            id: sale.id,
            offline: false,
            stock: buildStockNoticeLines(items, cart, updatedById, threshold),
          };
        } catch (e) {
          console.warn("[POS] online checkout failed, queueing", e);
        }
      }
      // Offline path: queue as a single atomic offline_sale
      await enqueue({
        entity: "offline_sale",
        op: "sale",
        client_ref,
        payload: { ...salePayload, items } as unknown as Record<string, unknown>,
      });
      emitChange("queue");
      return {
        id: client_ref,
        offline: true,
        stock: buildStockNoticeLines(items, cart, localStock, threshold),
      };
    },
    onSuccess: async (res) => {
      setLastSaleNotice({ offline: res.offline, lines: res.stock });
      setSessionStock((prev) => {
        const byId = new Map(prev.map((l) => [l.product_id, { ...l, sold: 0 }]));
        for (const line of res.stock) {
          const existing = byId.get(line.product_id);
          byId.set(line.product_id, {
            ...line,
            sold: (existing?.sold ?? 0) + line.sold,
          });
        }
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
      const soldSummary = res.stock
        .map((line) => `${line.name}: ${line.sold} sold, ${line.remaining} left`)
        .join("\n");
      toast.success(res.offline ? "Sale saved offline" : "Sale completed", {
        description: soldSummary || undefined,
        duration: 7000,
      });
      for (const line of res.stock) {
        if (line.level === "out") {
          toast.error(`${line.name} is finished — 0 left. Restock now.`, { duration: 10000 });
        } else if (line.level === "low") {
          toast.error(
            `${line.name} is low — ${line.remaining} left (minimum ${line.min}). Restock now.`,
            {
              duration: 10000,
            },
          );
        }
      }
      qc.setQueryData<Product[]>(["pos-products"], (old) => {
        if (!old) return old;
        const byId = new Map(res.stock.map((line) => [line.product_id, line]));
        return old.map((p) => {
          const line = byId.get(p.id);
          return line ? { ...p, quantity: line.remaining, min_stock: line.min } : p;
        });
      });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      printReceipt(res.id);
      setCart([]);
      setCashReceived("");
      setDiscountPct(0);
      if (!res.offline) void runSync();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function printReceipt(saleId: string) {
    // rely on print-only render in sales route; easier: build a mini print window
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) return;
    const lines = cart
      .map(
        (l) =>
          `<tr><td>${l.product.name}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${formatNaira(
            Number(l.product.selling_price) * l.qty,
          )}</td></tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><title>Receipt</title>
<style>
@page { size: 80mm auto; margin: 0; }
html,body{margin:0;padding:0}
body{font-family:ui-monospace,Menlo,Consolas,monospace;padding:6mm 4mm;font-size:11px;width:72mm;color:#000}
h2{margin:0;text-align:center;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}
td,th{padding:2px 0}
.tot{border-top:1px dashed #000;margin-top:8px;padding-top:6px}
.row{display:flex;justify-content:space-between;gap:8px}
.muted{color:#444;text-align:center;font-size:10px}
@media print { body { width: 72mm; } }
</style></head><body>
<h2>${settings.data?.store_name ?? "My Spot"}</h2>
<div class="muted">Receipt · ${saleId.slice(0, 8)}</div>
<div class="muted">${new Date().toLocaleString("en-NG")}</div>
<table><thead><tr><th style="text-align:left">Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Total</th></tr></thead><tbody>${lines}</tbody></table>
<div class="tot">
<div class="row"><span>Subtotal</span><span>${formatNaira(subtotal)}</span></div>
${discount ? `<div class="row"><span>Discount</span><span>-${formatNaira(discount)}</span></div>` : ""}
${tax ? `<div class="row"><span>Tax</span><span>${formatNaira(tax)}</span></div>` : ""}
<div class="row" style="font-weight:700;font-size:13px;margin-top:4px"><span>Total</span><span>${formatNaira(total)}</span></div>
<div class="row"><span>Payment</span><span>${payment}</span></div>
${payment === "cash" && typeof cashReceived === "number" ? `<div class="row"><span>Change</span><span>${formatNaira(change)}</span></div>` : ""}
</div>
<p class="muted" style="margin-top:12px">${settings.data?.receipt_footer ?? "Thank you!"}</p>
<script>window.print();</script>
</body></html>`);
    w.document.close();
  }

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        {lastSaleNotice && <StockNotice notice={lastSaleNotice} />}

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-xs text-muted-foreground">
              Scan or search a product to add it to the sale.
            </div>
            <PendingSalesButton />
          </div>
          <form onSubmit={scanSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={scanRef}
                autoFocus
                className="pl-9"
                placeholder="Scan barcode or search product…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline">
              Enter
            </Button>
          </form>
        </Card>

        {sessionStock.length > 0 && (
          <StockStatusPanel lines={sessionStock} onClear={() => setSessionStock([])} />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => add(p)}
              className="text-left rounded-xl border bg-card p-4 hover:border-primary hover:shadow-sm transition"
              disabled={p.quantity <= 0}
            >
              <div className="font-medium text-sm line-clamp-2">{p.name}</div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-primary font-semibold text-sm">
                  {formatNaira(p.selling_price)}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    p.quantity <= 0 ? "bg-destructive/15 text-destructive" : "bg-muted"
                  }`}
                >
                  {p.quantity}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-sm text-muted-foreground py-8">
              No matching products.
            </div>
          )}
        </div>
      </div>

      <Card className="lg:col-span-2 p-4 flex flex-col h-fit lg:sticky lg:top-20">
        <h3 className="font-semibold">Current sale</h3>
        <div className="flex-1 mt-3 space-y-2 min-h-[120px] max-h-[300px] overflow-auto">
          {cart.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Cart is empty. Scan or tap a product.
            </div>
          )}
          {cart.map((l) => (
            <div key={l.product.id} className="flex items-center gap-2 text-sm">
              <div className="flex-1">
                <div className="font-medium">{l.product.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatNaira(l.product.selling_price)} each
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() =>
                    setCart((c) =>
                      c
                        .map((x) => (x.product.id === l.product.id ? { ...x, qty: x.qty - 1 } : x))
                        .filter((x) => x.qty > 0),
                    )
                  }
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center">{l.qty}</span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() =>
                    setCart((c) =>
                      c.map((x) => (x.product.id === l.product.id ? { ...x, qty: x.qty + 1 } : x)),
                    )
                  }
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="w-20 text-right font-medium">
                {formatNaira(Number(l.product.selling_price) * l.qty)}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t mt-4 pt-4 space-y-2 text-sm">
          <Row label="Subtotal" value={formatNaira(subtotal)} />
          <div className="flex items-center gap-2">
            <Label className="flex-1">Discount %</Label>
            <Input
              type="number"
              className="w-24 text-right"
              value={discountPct}
              onChange={(e) => setDiscountPct(Number(e.target.value) || 0)}
            />
          </div>
          {discount > 0 && <Row label="Discount" value={`-${formatNaira(discount)}`} />}
          {taxRate > 0 && <Row label={`Tax (${taxRate}%)`} value={formatNaira(tax)} />}
          <Row label="Total" value={formatNaira(total)} big />

          <div className="flex items-center gap-2 pt-2">
            <Label className="flex-1">Payment</Label>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="transfer">Bank transfer</SelectItem>
                <SelectItem value="card">Card / POS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {payment === "cash" && (
            <>
              <div className="flex items-center gap-2">
                <Label className="flex-1">Cash received</Label>
                <Input
                  type="number"
                  className="w-32 text-right"
                  value={cashReceived}
                  onChange={(e) =>
                    setCashReceived(e.target.value === "" ? "" : Number(e.target.value))
                  }
                />
              </div>
              {change > 0 && <Row label="Change" value={formatNaira(change)} />}
            </>
          )}

          <Button
            size="lg"
            className="w-full mt-2"
            disabled={cart.length === 0 || checkout.isPending}
            onClick={() => checkout.mutate()}
          >
            {checkout.isPending ? "Processing…" : `Checkout · ${formatNaira(total)}`}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function buildStockNoticeLines(
  items: Array<{ product_id: string; name_snapshot: string; qty: number }>,
  cart: CartLine[],
  stockById: Map<string, { quantity: number; min_stock: number; name: string }>,
  threshold: number,
): StockNoticeLine[] {
  return items.map((it) => {
    const product = cart.find((l) => l.product.id === it.product_id)?.product;
    const stock = stockById.get(it.product_id);
    const remaining = Math.max(
      0,
      Number(stock?.quantity ?? (product ? product.quantity - it.qty : 0)),
    );
    const min = Number(stock?.min_stock ?? product?.min_stock ?? threshold ?? 0);
    return {
      product_id: it.product_id,
      name: stock?.name ?? product?.name ?? it.name_snapshot,
      sold: it.qty,
      remaining,
      min,
      level: remaining <= 0 ? "out" : remaining <= min ? "low" : "normal",
    };
  });
}

function StockNotice({ notice }: { notice: { offline: boolean; lines: StockNoticeLine[] } }) {
  const hasAlert = notice.lines.some((line) => line.level !== "normal");
  return (
    <Card
      role="status"
      aria-live="polite"
      className={`p-4 border ${hasAlert ? "border-destructive/40 bg-destructive/10" : "border-primary/20 bg-primary/5"}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${hasAlert ? "text-destructive" : "text-primary"}`}>
          {hasAlert ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {hasAlert ? "Stock alert" : notice.offline ? "Offline sale saved" : "Sale completed"}
          </div>
          <div className="mt-1 space-y-1 text-sm">
            {notice.lines.map((line) => (
              <div key={line.product_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{line.name} has been sold.</span>
                <span>{line.sold} sold.</span>
                <span
                  className={
                    line.level === "normal"
                      ? "text-muted-foreground"
                      : "font-semibold text-destructive"
                  }
                >
                  {line.remaining} left.
                </span>
                {line.level !== "normal" && <span className="text-destructive">Restock now.</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${big ? "text-lg font-display font-bold" : ""}`}
    >
      <span className={big ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StockStatusPanel({
  lines,
  onClear,
}: {
  lines: StockNoticeLine[];
  onClear: () => void;
}) {
  const hasAlert = lines.some((line) => line.level !== "normal");
  return (
    <Card
      role="status"
      aria-live="polite"
      className={`p-4 border ${hasAlert ? "border-destructive/40 bg-destructive/10" : "border-primary/20 bg-primary/5"}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Stock status — this session</h3>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>
          <Trash2 className="h-3 w-3 mr-1" />
          Clear
        </Button>
      </div>
      <div className="space-y-1.5 text-sm">
        {lines.map((line) => (
          <div
            key={line.product_id}
            className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border bg-background/60 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate">{line.name}</span>
              <span className="text-xs text-muted-foreground">
                {line.sold} sold
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  line.level === "out"
                    ? "bg-destructive/15 text-destructive font-semibold"
                    : line.level === "low"
                      ? "bg-destructive/15 text-destructive font-semibold"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {line.remaining} left
              </span>
              {line.level !== "normal" && (
                <span className="text-xs font-semibold text-destructive">
                  {line.level === "out" ? "Finished — restock now" : "Low — restock now"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

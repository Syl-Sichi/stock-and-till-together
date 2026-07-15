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
import { Minus, Plus, Search, Trash2, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { enqueue, getSnapshot, putSnapshot } from "@/lib/offline/db";
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
};

type CartLine = { product: Product; qty: number };

function POS() {
  const qc = useQueryClient();
  const settings = useSettings();
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [payment, setPayment] = useState("cash");
  const [cashReceived, setCashReceived] = useState<number | "">("");
  const scanRef = useRef<HTMLInputElement>(null);

  const products = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,barcode,selling_price,cost_price,quantity")
        .eq("archived", false)
        .order("name");
      if (error) throw error;
      return data as Product[];
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
        return c.map((l) =>
          l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l,
        );
      return [...c, { product, qty: 1 }];
    });
    setQ("");
  }

  function scanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    const match = (products.data ?? []).find((p) => p.barcode === q || p.name.toLowerCase() === q.toLowerCase());
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
        subtotal, discount, tax, total,
        payment_method: payment,
        cash_received: payment === "cash" && typeof cashReceived === "number" ? cashReceived : null,
      };

      // Optimistically decrement local product snapshots so UI stays correct offline
      for (const it of items) {
        const cur = await getSnapshot<{ id: string; quantity: number }>("products", it.product_id);
        if (cur) await putSnapshot("products", { ...cur, quantity: Math.max(0, Number(cur.quantity) - it.qty) });
      }

      if (isOnline()) {
        try {
          const { data: sale, error } = await supabase.from("sales")
            .upsert({ ...salePayload }, { onConflict: "client_ref" })
            .select("*").single();
          if (error) throw error;
          const { error: e2 } = await supabase.from("sale_items")
            .insert(items.map((it) => ({ ...it, sale_id: sale.id })));
          if (e2) throw e2;
          return { id: sale.id, offline: false };
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
      return { id: client_ref, offline: true };
    },
    onSuccess: async (res) => {
      toast.success(res.offline ? "Sale saved offline — will sync automatically" : "Sale completed");
      // Low-stock check on sold items (works in preview and offline)
      const threshold = Number(settings.data?.low_stock_threshold ?? 0);
      const alerts: string[] = [];
      for (const l of cart) {
        const snap = await getSnapshot<{ id: string; quantity: number; min_stock?: number; name?: string }>(
          "products", l.product.id,
        );
        const remaining = snap?.quantity ?? Math.max(0, l.product.quantity - l.qty);
        const min = Number(snap?.min_stock ?? threshold ?? 0);
        if (remaining <= min) {
          alerts.push(
            remaining === 0
              ? `${l.product.name} is out of stock`
              : `${l.product.name} is low — ${remaining} left (min ${min})`,
          );
        }
      }
      for (const msg of alerts) toast.warning(msg, { duration: 6000 });
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
<style>body{font-family:ui-sans-serif,system-ui;padding:16px;font-size:12px}h2{margin:0;text-align:center}
table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:3px 0}
.tot{border-top:1px dashed #000;margin-top:10px;padding-top:8px}</style></head><body>
<h2>${settings.data?.store_name ?? "My Spot"}</h2>
<div style="text-align:center;color:#555">Receipt · ${saleId.slice(0, 8)}</div>
<div style="text-align:center;color:#555">${new Date().toLocaleString("en-NG")}</div>
<table><thead><tr><th style="text-align:left">Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Total</th></tr></thead><tbody>${lines}</tbody></table>
<div class="tot">
<div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${formatNaira(subtotal)}</span></div>
${discount ? `<div style="display:flex;justify-content:space-between"><span>Discount</span><span>-${formatNaira(discount)}</span></div>` : ""}
${tax ? `<div style="display:flex;justify-content:space-between"><span>Tax</span><span>${formatNaira(tax)}</span></div>` : ""}
<div style="display:flex;justify-content:space-between;font-weight:700;font-size:14px;margin-top:4px"><span>Total</span><span>${formatNaira(total)}</span></div>
<div style="display:flex;justify-content:space-between"><span>Payment</span><span>${payment}</span></div>
${payment === "cash" && typeof cashReceived === "number" ? `<div style="display:flex;justify-content:space-between"><span>Change</span><span>${formatNaira(change)}</span></div>` : ""}
</div>
<p style="text-align:center;margin-top:16px;color:#555">${settings.data?.receipt_footer ?? "Thank you!"}</p>
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
            <Button type="submit" variant="outline">Enter</Button>
          </form>
        </Card>


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
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
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

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${big ? "text-lg font-display font-bold" : ""}`}>
      <span className={big ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

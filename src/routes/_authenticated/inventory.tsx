import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatNaira } from "@/lib/format";
import { Archive, Edit, Plus, Search, Trash2 } from "lucide-react";
import { useCurrentRole } from "@/hooks/useCurrentRole";

export const Route = createFileRoute("/_authenticated/inventory")({
  component: Inventory,
});

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  quantity: number;
  min_stock: number;
  archived: boolean;
  brand: string | null;
  expiry_date: string | null;
};

function Inventory() {
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();
  const canWrite = role === "owner" || role === "manager";
  const canDelete = role === "owner";
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);

  const products = useQuery({
    queryKey: ["products", showArchived],
    queryFn: async () => {
      let query = supabase.from("products").select("*").order("name");
      if (!showArchived) query = query.eq("archived", false);
      const { data, error } = await query;
      if (error) throw error;
      return data as Product[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product deleted");
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from("products").update({ archived }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (products.data ?? []).filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.sku?.toLowerCase().includes(q.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, SKU, or barcode…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {canWrite && (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" /> New product
              </Button>
            </DialogTrigger>
            <ProductDialog
              product={editing}
              onDone={() => {
                setOpen(false);
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["products"] });
              }}
            />
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3">SKU / Barcode</th>
                <th className="p-3 text-right">Cost</th>
                <th className="p-3 text-right">Price</th>
                <th className="p-3 text-right">Stock</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const low = p.quantity > 0 && p.quantity <= p.min_stock;
                const out = p.quantity <= 0;
                return (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <div className="font-medium">{p.name}</div>
                      {p.brand && <div className="text-xs text-muted-foreground">{p.brand}</div>}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      <div>{p.sku ?? "—"}</div>
                      <div className="text-xs">{p.barcode ?? ""}</div>
                    </td>
                    <td className="p-3 text-right">{formatNaira(p.cost_price)}</td>
                    <td className="p-3 text-right font-medium">{formatNaira(p.selling_price)}</td>
                    <td className="p-3 text-right">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                          out
                            ? "bg-destructive/15 text-destructive"
                            : low
                            ? "bg-warning/25 text-warning-foreground"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {p.quantity}
                      </span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {canWrite && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(p);
                              setOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => archive.mutate({ id: p.id, archived: !p.archived })}
                            title={p.archived ? "Unarchive" : "Archive"}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`Delete "${p.name}"? This cannot be undone.`))
                              del.mutate(p.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No products yet. Add your first one.
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

function ProductDialog({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const [form, setForm] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    brand: product?.brand ?? "",
    cost_price: product?.cost_price ?? 0,
    selling_price: product?.selling_price ?? 0,
    quantity: product?.quantity ?? 0,
    min_stock: product?.min_stock ?? 5,
    expiry_date: product?.expiry_date ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      sku: form.sku || null,
      barcode: form.barcode || null,
      brand: form.brand || null,
      expiry_date: form.expiry_date || null,
    };
    const { error } = product
      ? await supabase.from("products").update(payload).eq("id", product.id)
      : await supabase.from("products").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(product ? "Product updated" : "Product created");
    onDone();
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={save} className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>SKU</Label>
            <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <Label>Barcode</Label>
            <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>Brand</Label>
          <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Cost price (₦)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Selling price (₦)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.selling_price}
              onChange={(e) => setForm({ ...form, selling_price: Number(e.target.value) })}
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Quantity</Label>
            <Input
              type="number"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Min stock</Label>
            <Input
              type="number"
              value={form.min_stock}
              onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })}
            />
          </div>
        </div>
        <div>
          <Label>Expiry date</Label>
          <Input
            type="date"
            value={form.expiry_date ?? ""}
            onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : product ? "Save changes" : "Create product"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

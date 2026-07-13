import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
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
import { Archive, Edit, Plus, Search, Trash2, Upload, FileDown, ImagePlus, X } from "lucide-react";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { ProductImage } from "@/components/ProductImage";
import { uploadProductImage, removeProductImage, getProductImageUrl } from "@/lib/product-image";
import { parseCsv, importProducts, downloadSampleCsv, type ImportResult } from "@/lib/csv-import";
import { repoInsert, repoUpdate, repoDelete } from "@/lib/offline/repo";

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
  image_url: string | null;
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
  const [importOpen, setImportOpen] = useState(false);

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
    mutationFn: async (p: Product) => {
      if (p.image_url) await removeProductImage(p.image_url).catch(() => {});
      const { error } = await supabase.from("products").delete().eq("id", p.id);
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
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1" /> Import CSV
            </Button>
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
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 w-14"></th>
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
                      <ProductImage path={p.image_url} alt={p.name} />
                    </td>
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
                              del.mutate(p);
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
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No products yet. Add your first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => qc.invalidateQueries({ queryKey: ["products"] })}
      />
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
  const [imagePath, setImagePath] = useState<string | null>(product?.image_url ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load preview for existing image
  useEffect(() => {
    if (imagePath && !imagePath.startsWith("blob:")) getProductImageUrl(imagePath).then(setPreviewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be under 5MB");
    setUploading(true);
    try {
      // Show local preview immediately
      setPreviewUrl(URL.createObjectURL(file));
      const path = await uploadProductImage(file);
      // Remove previous stored image if replacing
      if (imagePath && imagePath !== path) await removeProductImage(imagePath).catch(() => {});
      setImagePath(path);
      const url = await getProductImageUrl(path);
      setPreviewUrl(url);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearImage() {
    if (imagePath) await removeProductImage(imagePath).catch(() => {});
    setImagePath(null);
    setPreviewUrl(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      sku: form.sku || null,
      barcode: form.barcode || null,
      brand: form.brand || null,
      expiry_date: form.expiry_date || null,
      image_url: imagePath,
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
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={save} className="space-y-3">
        <div>
          <Label>Product image</Label>
          <div className="flex items-center gap-3 mt-1">
            <div className="h-20 w-20 rounded-md bg-muted overflow-hidden grid place-items-center">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickImage}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading…" : previewUrl ? "Replace image" : "Upload image"}
              </Button>
              {previewUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={clearImage}
                >
                  <X className="h-3 w-3 mr-1" /> Remove
                </Button>
              )}
            </div>
          </div>
        </div>
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

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const rows = await parseCsv(file);
      if (!rows.length) throw new Error("CSV has no rows");
      const r = await importProducts(rows);
      setResult(r);
      if (r.created + r.updated > 0) {
        toast.success(`Imported ${r.created} new, updated ${r.updated}`);
        onDone();
      } else {
        toast.error("Nothing imported");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Upload a CSV with columns: <code>name, sku, barcode, brand, cost_price, selling_price,
            quantity, min_stock, expiry_date</code>. Rows are matched to existing products by SKU —
            an existing SKU updates that product, otherwise a new product is created.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadSampleCsv}>
              <FileDown className="h-4 w-4 mr-1" /> Download sample
            </Button>
            <Button
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1" /> {busy ? "Importing…" : "Choose CSV file"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFile}
            />
          </div>
          {result && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="text-primary font-medium">✓ {result.created} created</span>
                <span className="text-primary font-medium">↻ {result.updated} updated</span>
                {result.skipped > 0 && (
                  <span className="text-destructive font-medium">✕ {result.skipped} skipped</span>
                )}
              </div>
              {result.errors.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">View {result.errors.length} error(s)</summary>
                  <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                    {result.errors.slice(0, 50).map((e, i) => (
                      <li key={i}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

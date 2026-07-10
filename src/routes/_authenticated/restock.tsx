import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
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
import { toast } from "sonner";
import { formatDate, formatNaira } from "@/lib/format";
import { useCurrentRole } from "@/hooks/useCurrentRole";

export const Route = createFileRoute("/_authenticated/restock")({
  component: Restock,
});

function Restock() {
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();
  const canWrite = role === "owner" || role === "manager";
  const [productId, setProductId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState(0);

  const products = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id,name,quantity,cost_price").eq("archived", false).order("name")).data ?? [],
  });
  const suppliers = useQuery({
    queryKey: ["suppliers-min"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const history = useQuery({
    queryKey: ["restocks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("restocks")
        .select("id,qty,unit_cost,created_at,products(name),suppliers(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("restocks").insert({
        product_id: productId,
        supplier_id: supplierId || null,
        qty,
        unit_cost: unitCost,
        created_by: userData.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock updated");
      setQty(1);
      setUnitCost(0);
      setProductId("");
      setSupplierId("");
      qc.invalidateQueries({ queryKey: ["restocks"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["products-min"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-5 lg:col-span-1">
        <h3 className="font-semibold mb-3">Add stock</h3>
        {!canWrite ? (
          <p className="text-sm text-muted-foreground">Only managers and owners can add stock.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <Label>Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {products.data?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.quantity})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Supplier (optional)</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {suppliers.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quantity</Label><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
              <div><Label>Unit cost</Label><Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} /></div>
            </div>
            <Button type="submit" className="w-full" disabled={!productId || qty < 1 || add.isPending}>
              {add.isPending ? "Saving…" : "Add to stock"}
            </Button>
          </form>
        )}
      </Card>

      <Card className="p-5 lg:col-span-2 overflow-hidden">
        <h3 className="font-semibold mb-3">Restock history</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Product</th>
                <th className="p-2">Supplier</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 text-xs">{formatDate(r.created_at)}</td>
                  <td className="p-2">{(r as any).products?.name ?? "—"}</td>
                  <td className="p-2">{(r as any).suppliers?.name ?? "—"}</td>
                  <td className="p-2 text-right">{r.qty}</td>
                  <td className="p-2 text-right">{formatNaira(r.unit_cost)}</td>
                </tr>
              ))}
              {(history.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No restock records yet.
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

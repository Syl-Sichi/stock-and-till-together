import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { EnableNotifications } from "@/components/EnableNotifications";
import { repoUpdate } from "@/lib/offline/repo";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();
  const canEdit = role === "owner";
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({
    store_name: "",
    tax_rate: 0,
    low_stock_threshold: 5,
    receipt_footer: "",
  });

  useEffect(() => {
    if (settings.data)
      setForm({
        store_name: settings.data.store_name,
        tax_rate: Number(settings.data.tax_rate),
        low_stock_threshold: settings.data.low_stock_threshold,
        receipt_footer: settings.data.receipt_footer ?? "",
      });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      await repoUpdate("settings", "1", form);
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-display text-xl font-bold">Store settings</h3>
          <p className="text-sm text-muted-foreground">
            {canEdit ? "Update how My Spot displays your shop." : "Only the owner can change store settings."}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Store name</Label>
            <Input
              value={form.store_name}
              onChange={(e) => setForm({ ...form, store_name: e.target.value })}
              disabled={!canEdit}
            />
          </div>
          <div>
            <Label>Tax rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              value={form.tax_rate}
              onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })}
              disabled={!canEdit}
            />
          </div>
          <div>
            <Label>Low-stock threshold</Label>
            <Input
              type="number"
              value={form.low_stock_threshold}
              onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })}
              disabled={!canEdit}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Receipt footer</Label>
            <Input
              value={form.receipt_footer}
              onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
              disabled={!canEdit}
            />
          </div>
        </div>
        {canEdit && (
          <div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </Card>
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-display text-xl font-bold">Notifications</h3>
          <p className="text-sm text-muted-foreground">
            Get alerts when items dip below your minimum stock and when the daily 9 PM report is ready.
            Works after publishing the app; on iPhone, install to Home Screen first.
          </p>
        </div>
        <EnableNotifications />
      </Card>
    </div>
  );
}

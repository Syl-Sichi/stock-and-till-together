import { useEffect, useState } from "react";
import { Clock, RefreshCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  dequeue, getSnapshot, listQueue, logActivity, putSnapshot, type QueuedMutation,
} from "@/lib/offline/db";
import { emitChange, isOnline, onChange, onNetworkChange } from "@/lib/offline/network";
import { runSync } from "@/lib/offline/sync";
import { formatNaira } from "@/lib/format";
import { toast } from "sonner";

type OfflineSaleItem = {
  product_id: string;
  name_snapshot: string;
  qty: number;
  unit_price: number;
  line_total: number;
};
type OfflineSalePayload = {
  client_ref: string;
  total: number;
  payment_method: string;
  items: OfflineSaleItem[];
};

export function PendingSalesButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<QueuedMutation[]>([]);

  const refresh = () => { void listQueue().then((q) => setPending(q.filter((m) => m.entity === "offline_sale"))); };

  useEffect(() => {
    refresh();
    const offQ = onChange("queue", refresh);
    const offN = onNetworkChange(refresh);
    return () => { offQ(); offN(); };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border bg-muted"
        title="View sales queued while offline"
      >
        <Clock className="h-3 w-3" />
        Pending sales{pending.length > 0 ? ` · ${pending.length}` : ""}
      </button>
      <PendingDialog open={open} onOpenChange={setOpen} pending={pending} onChanged={refresh} />
    </>
  );
}

function PendingDialog({
  open, onOpenChange, pending, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: QueuedMutation[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const online = isOnline();

  async function retryAll() {
    setBusy("all");
    try {
      const res = await runSync();
      if (res.applied > 0) toast.success(`Synced ${res.applied} sale${res.applied === 1 ? "" : "s"}`);
      else if (res.failed > 0) toast.error("Some sales still cannot sync");
      else toast.info("Nothing to sync");
    } finally { setBusy(null); onChanged(); }
  }

  async function cancelSale(m: QueuedMutation) {
    const p = m.payload as unknown as OfflineSalePayload;
    if (!confirm(`Cancel offline sale ${p.client_ref.slice(0, 8)} for ${formatNaira(p.total)}?\nLocal stock levels will be restored.`))
      return;
    setBusy(m.id);
    try {
      // Restore local product snapshot quantities that were optimistically decremented at checkout.
      for (const it of p.items) {
        const cur = await getSnapshot<{ id: string; quantity: number }>("products", it.product_id);
        if (cur) await putSnapshot("products", { ...cur, quantity: Number(cur.quantity) + it.qty });
      }
      await dequeue(m.id);
      emitChange("queue");
      toast.success("Offline sale cancelled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally { setBusy(null); onChanged(); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pending offline sales</DialogTitle>
          <DialogDescription>
            These sales are saved on this device and will upload automatically when you are online.
            You can force a retry or cancel a sale before it syncs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-muted-foreground">
            {online ? "Online" : "Offline"} · {pending.length} queued
          </div>
          <Button size="sm" onClick={retryAll} disabled={!online || busy !== null || pending.length === 0}>
            <RefreshCcw className={`h-3 w-3 mr-1 ${busy === "all" ? "animate-spin" : ""}`} />
            Retry all
          </Button>
        </div>

        {pending.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No pending sales. All checkouts are in sync.
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((m) => {
              const p = m.payload as unknown as OfflineSalePayload;
              return (
                <Card key={m.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        Ref <span className="font-mono">{p.client_ref.slice(0, 8)}</span>
                        <span className="text-muted-foreground"> · {p.payment_method}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Queued {new Date(m.created_at).toLocaleString("en-NG")}
                      </div>
                      <ul className="mt-2 text-xs space-y-0.5">
                        {p.items.map((it, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span className="truncate">{it.name_snapshot} × {it.qty}</span>
                            <span className="text-muted-foreground shrink-0">{formatNaira(it.line_total)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold">{formatNaira(p.total)}</div>
                      <div className="mt-2 flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!online || busy !== null}
                          onClick={async () => {
                            setBusy(m.id);
                            try {
                              const res = await runSync();
                              if (res.applied > 0) toast.success("Sale synced");
                              else if (res.failed > 0) toast.error("Retry failed");
                            } finally { setBusy(null); onChanged(); }
                          }}
                        >
                          <RefreshCcw className={`h-3 w-3 mr-1 ${busy === m.id ? "animate-spin" : ""}`} />
                          Retry
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={busy !== null}
                          onClick={() => cancelSale(m)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-3 w-3 mr-1" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

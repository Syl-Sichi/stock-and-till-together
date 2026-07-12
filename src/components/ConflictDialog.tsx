import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  type Conflict, listConflicts, putSnapshot, resolveConflict,
} from "@/lib/offline/db";
import { emitChange, onChange } from "@/lib/offline/network";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function ConflictBanner() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => { void listConflicts().then(setConflicts); };
    refresh();
    return onChange("conflicts", refresh);
  }, []);

  if (conflicts.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-destructive/10 text-destructive border border-destructive/30"
      >
        <AlertTriangle className="h-3 w-3" />
        {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
      </button>
      <ConflictDialog open={open} onOpenChange={setOpen} conflicts={conflicts} />
    </>
  );
}

function ConflictDialog({
  open, onOpenChange, conflicts,
}: { open: boolean; onOpenChange: (v: boolean) => void; conflicts: Conflict[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolve offline conflicts</DialogTitle>
          <DialogDescription>
            These changes you made offline collided with newer edits on the server. Pick which one wins per row.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {conflicts.map((c) => (
            <ConflictRow key={c.id} c={c} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConflictRow({ c }: { c: Conflict }) {
  const [busy, setBusy] = useState(false);
  async function keepMine() {
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from(c.entity)
        .update(c.local).eq("id", c.target_id).select().maybeSingle();
      if (error) throw error;
      if (data) await putSnapshot(c.entity, data as { id: string });
      await resolveConflict(c.id);
      emitChange("conflicts");
      toast.success("Your version applied");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }
  async function keepServer() {
    setBusy(true);
    try {
      await putSnapshot(c.entity, c.server as { id: string });
      await resolveConflict(c.id);
      emitChange("conflicts");
      toast.success("Server version kept");
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-medium capitalize mb-2">{c.entity} · {c.target_id.slice(0, 8)}</div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-semibold mb-1 text-primary">Your offline version</div>
          <FieldList data={c.local} highlight={c.fields} />
        </div>
        <div>
          <div className="font-semibold mb-1">Server version</div>
          <FieldList data={c.server} highlight={c.fields} />
        </div>
      </div>
      <div className="mt-3 flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={keepServer} disabled={busy}>Keep server</Button>
        <Button size="sm" onClick={keepMine} disabled={busy}>Keep mine</Button>
      </div>
    </div>
  );
}

function FieldList({ data, highlight }: { data: Record<string, unknown>; highlight: string[] }) {
  const keys = highlight.length ? highlight : Object.keys(data);
  return (
    <dl className="space-y-1">
      {keys.map((k) => (
        <div key={k} className={`flex justify-between gap-2 ${highlight.includes(k) ? "bg-amber-50 rounded px-1" : ""}`}>
          <dt className="text-muted-foreground truncate">{k}</dt>
          <dd className="font-mono truncate">{String(data[k] ?? "—")}</dd>
        </div>
      ))}
    </dl>
  );
}

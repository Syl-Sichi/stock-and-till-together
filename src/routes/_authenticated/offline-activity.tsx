import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, ChevronDown, CircleAlert, CircleX, Clock,
  GitMerge, RefreshCcw, ShieldCheck, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  clearActivity, listActivity, type ActivityEntry, type ActivityKind,
} from "@/lib/offline/db";
import { onChange } from "@/lib/offline/network";
import { runSync } from "@/lib/offline/sync";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/offline-activity")({
  component: OfflineActivity,
});

const KIND_META: Record<ActivityKind, { label: string; icon: typeof Clock; className: string }> = {
  queued:            { label: "Queued",       icon: Clock,        className: "bg-muted text-muted-foreground" },
  synced:            { label: "Synced",       icon: CheckCircle2, className: "bg-primary/10 text-primary" },
  failed:            { label: "Failed",       icon: CircleX,      className: "bg-destructive/15 text-destructive" },
  conflict_detected: { label: "Conflict",     icon: CircleAlert,  className: "bg-amber-100 text-amber-800" },
  conflict_resolved: { label: "Resolved",     icon: ShieldCheck,  className: "bg-emerald-100 text-emerald-800" },
  cancelled:         { label: "Cancelled",    icon: Trash2,       className: "bg-muted text-muted-foreground" },
};

function OfflineActivity() {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [kind, setKind] = useState<"all" | ActivityKind>("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);

  const refresh = () => { void listActivity(1000).then(setRows); };
  useEffect(() => {
    refresh();
    const offQ = onChange("queue", refresh);
    const offC = onChange("conflicts", refresh);
    return () => { offQ(); offC(); };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (!s) return true;
      return (
        r.entity.toLowerCase().includes(s) ||
        (r.client_ref?.toLowerCase().includes(s) ?? false) ||
        (r.target_id?.toLowerCase().includes(s) ?? false) ||
        (r.server_id?.toLowerCase().includes(s) ?? false) ||
        (r.message?.toLowerCase().includes(s) ?? false)
      );
    });
  }, [rows, kind, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: rows.length };
    for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await runSync();
      toast.success(`Sync: ${res.applied} applied, ${res.conflicts} conflicts, ${res.failed} failed`);
    } finally { setSyncing(false); refresh(); }
  }

  async function clearAll() {
    if (!confirm("Clear all offline activity history? This does not touch queued changes or data.")) return;
    await clearActivity();
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            placeholder="Search by ref, id, entity, or message…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events ({counts.total ?? 0})</SelectItem>
              <SelectItem value="queued">Queued ({counts.queued ?? 0})</SelectItem>
              <SelectItem value="synced">Synced ({counts.synced ?? 0})</SelectItem>
              <SelectItem value="failed">Failed ({counts.failed ?? 0})</SelectItem>
              <SelectItem value="conflict_detected">Conflicts ({counts.conflict_detected ?? 0})</SelectItem>
              <SelectItem value="conflict_resolved">Resolved ({counts.conflict_resolved ?? 0})</SelectItem>
              <SelectItem value="cancelled">Cancelled ({counts.cancelled ?? 0})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={syncNow} disabled={syncing}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} /> Sync now
        </Button>
        <Button variant="ghost" onClick={clearAll} className="text-muted-foreground">
          <Trash2 className="h-4 w-4 mr-1" /> Clear history
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {(["queued","synced","failed","conflict_detected","conflict_resolved","cancelled"] as ActivityKind[]).map((k) => {
          const meta = KIND_META[k];
          const Icon = meta.icon;
          return (
            <Card key={k} className="p-3">
              <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                <Icon className="h-3 w-3" /> {meta.label}
              </div>
              <div className="mt-1 text-2xl font-display font-bold">{counts[k] ?? 0}</div>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Event</th>
                <th className="p-3">Entity / Op</th>
                <th className="p-3">Reference</th>
                <th className="p-3">Details</th>
                <th className="p-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = KIND_META[r.kind];
                const Icon = meta.icon;
                const isOpen = !!expanded[r.id];
                return (
                  <>
                    <tr key={r.id} className="border-t hover:bg-muted/30 align-top">
                      <td className="p-3 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("en-NG")}
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="font-medium capitalize">{r.entity.replace("_", " ")}</div>
                        {r.op && <div className="text-xs text-muted-foreground">{r.op}</div>}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {r.client_ref && (
                          <div title={r.client_ref}>
                            <span className="text-muted-foreground">ref </span>{r.client_ref.slice(0, 8)}
                          </div>
                        )}
                        {r.target_id && (
                          <div title={r.target_id}>
                            <span className="text-muted-foreground">id </span>{r.target_id.slice(0, 8)}
                          </div>
                        )}
                        {r.server_id && r.server_id !== r.target_id && (
                          <div title={r.server_id}>
                            <span className="text-muted-foreground">srv </span>{r.server_id.slice(0, 8)}
                          </div>
                        )}
                        {!r.client_ref && !r.target_id && !r.server_id && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {r.kind === "conflict_resolved" && r.choice && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">
                            <GitMerge className="h-3 w-3" />
                            {r.choice === "keep_mine" ? "Kept your version" : "Kept server version"}
                          </span>
                        )}
                        {r.fields && r.fields.length > 0 && (
                          <div className="text-muted-foreground mt-1">
                            Fields: {r.fields.join(", ")}
                          </div>
                        )}
                        {r.message && <div className="mt-1 text-destructive">{r.message}</div>}
                        {!r.message && !r.choice && !(r.fields && r.fields.length) && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          className="text-muted-foreground"
                          onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                          title="Show raw entry"
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-raw`} className="bg-muted/20 border-t">
                        <td colSpan={6} className="p-3">
                          <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(r, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No offline activity yet. Edits made without a connection will show up here.
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

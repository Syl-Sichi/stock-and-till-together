// SyncManager: replays queued mutations, detects conflicts, refreshes snapshots.
import { supabase } from "@/integrations/supabase/client";
import {
  addConflict,
  bulkPutSnapshot,
  dequeue,
  deleteSnapshot,
  type EntityName,
  listQueue,
  putSnapshot,
} from "./db";
import { emitChange, isOnline, onNetworkChange } from "./network";

// Fields we consider "user-editable" per entity for conflict comparison.
const EDITABLE_FIELDS: Record<EntityName, string[]> = {
  products: ["name", "sku", "barcode", "brand", "category_id", "supplier_id",
    "cost_price", "selling_price", "quantity", "min_stock", "image_url",
    "expiry_date", "archived"],
  suppliers: ["name", "phone", "email", "notes"],
  sales: [], // append-only, no conflicts
  sale_items: [],
  settings: ["store_name", "currency", "tax_rate", "low_stock_threshold", "receipt_footer"],
};

export async function refreshSnapshot(entity: EntityName) {
  if (!isOnline()) return;
  const { data, error } = await supabase.from(entity).select("*");
  if (error || !data) return;
  await bulkPutSnapshot(entity, data as Array<{ id: string } & Record<string, unknown>>);
}

export async function refreshAll() {
  await Promise.all([
    refreshSnapshot("products"),
    refreshSnapshot("suppliers"),
    refreshSnapshot("settings"),
  ]);
}

let syncing = false;
export async function runSync(): Promise<{ applied: number; conflicts: number; failed: number }> {
  if (syncing || !isOnline()) return { applied: 0, conflicts: 0, failed: 0 };
  syncing = true;
  let applied = 0, conflicts = 0, failed = 0;
  try {
    const queue = await listQueue();
    for (const m of queue) {
      try {
        if (m.op === "insert") {
          const payload = { ...m.payload };
          if (m.client_ref) (payload as Record<string, unknown>).client_ref = m.client_ref;
          const { data, error } = await supabase.from(m.entity).upsert(
            payload,
            m.client_ref ? { onConflict: "client_ref" } : undefined,
          ).select().maybeSingle();
          if (error) throw error;
          if (data) await putSnapshot(m.entity, data as { id: string });
          await dequeue(m.id); applied++;
        } else if (m.op === "delete" && m.target_id) {
          const { error } = await supabase.from(m.entity).delete().eq("id", m.target_id);
          if (error) throw error;
          await deleteSnapshot(m.entity, m.target_id);
          await dequeue(m.id); applied++;
        } else if (m.op === "update" && m.target_id) {
          const { data: server, error: sErr } = await supabase
            .from(m.entity).select("*").eq("id", m.target_id).maybeSingle();
          if (sErr) throw sErr;
          if (!server) { await dequeue(m.id); continue; }

          const baseUpdated = m.base_updated_at ?? null;
          const serverUpdated = (server as Record<string, unknown>).updated_at as string | null;
          const changed = baseUpdated && serverUpdated && baseUpdated !== serverUpdated;

          const editable = EDITABLE_FIELDS[m.entity];
          const localChanges = Object.fromEntries(
            Object.entries(m.payload).filter(([k]) => editable.includes(k)),
          );
          const overlapping = changed
            ? Object.keys(localChanges).filter((k) => {
                const s = (server as Record<string, unknown>)[k];
                return JSON.stringify(s) !== JSON.stringify(localChanges[k]);
              })
            : [];

          if (overlapping.length > 0) {
            await addConflict({
              entity: m.entity,
              target_id: m.target_id,
              local: localChanges,
              server: server as Record<string, unknown>,
              fields: overlapping,
            });
            await dequeue(m.id);
            conflicts++;
            continue;
          }
          // No overlap -> safe to apply (merge)
          const { data, error } = await supabase.from(m.entity)
            .update(localChanges).eq("id", m.target_id).select().maybeSingle();
          if (error) throw error;
          if (data) await putSnapshot(m.entity, data as { id: string });
          await dequeue(m.id); applied++;
        }
      } catch (err) {
        console.warn("[sync] failed", m, err);
        failed++;
      }
    }
    if (applied || conflicts) {
      emitChange("queue");
      if (conflicts) emitChange("conflicts");
    }
    return { applied, conflicts, failed };
  } finally {
    syncing = false;
  }
}

let started = false;
export function startSyncLoop() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refreshAll();
  void runSync();
  onNetworkChange(() => { void refreshAll(); void runSync(); });
  window.setInterval(() => { void runSync(); }, 60_000);
}

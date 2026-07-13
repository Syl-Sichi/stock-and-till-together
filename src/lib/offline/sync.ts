// SyncManager: replays queued mutations, detects conflicts, refreshes snapshots.
import { supabase } from "@/integrations/supabase/client";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
import {
  addConflict,
  bulkPutSnapshot,
  dequeue,
  deleteSnapshot,
  type EntityName,
  listQueue,
  logActivity,
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
  const { data, error } = await sb.from(entity).select("*");
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
        if (m.op === "sale" && m.entity === "offline_sale") {
          const p = m.payload as unknown as {
            client_ref: string; subtotal: number; discount: number; tax: number; total: number;
            payment_method: string; cash_received: number | null; cashier_id: string | null;
            items: Array<Record<string, unknown>>;
          };
          const { data: sale, error } = await sb.from("sales").upsert(
            {
              client_ref: p.client_ref,
              cashier_id: p.cashier_id, subtotal: p.subtotal, discount: p.discount,
              tax: p.tax, total: p.total, payment_method: p.payment_method,
              cash_received: p.cash_received,
            },
            { onConflict: "client_ref" },
          ).select().maybeSingle();
          if (error) throw error;
          if (sale) {
            const { count } = await sb.from("sale_items").select("id", { count: "exact", head: true }).eq("sale_id", sale.id);
            if (!count) {
              const items = p.items.map((it) => ({ ...it, sale_id: sale.id }));
              await sb.from("sale_items").insert(items);
            }
          }
          await dequeue(m.id); applied++;
          await logActivity({
            kind: "synced", entity: m.entity, op: m.op,
            client_ref: m.client_ref ?? p.client_ref, server_id: sale?.id ?? null,
          });
          continue;
        }

        const entity = m.entity as EntityName;
        if (m.op === "insert") {
          const payload = { ...m.payload };
          if (m.client_ref) (payload as Record<string, unknown>).client_ref = m.client_ref;
          const { data, error } = await sb.from(entity).upsert(
            payload,
            m.client_ref ? { onConflict: "client_ref" } : undefined,
          ).select().maybeSingle();
          if (error) throw error;
          if (data) await putSnapshot(entity, data as { id: string });
          await dequeue(m.id); applied++;
          await logActivity({
            kind: "synced", entity, op: m.op,
            client_ref: m.client_ref ?? null,
            server_id: (data as { id?: string } | null)?.id ?? null,
          });
        } else if (m.op === "delete" && m.target_id) {
          const { error } = await sb.from(entity).delete().eq("id", m.target_id);
          if (error) throw error;
          await deleteSnapshot(entity, m.target_id);
          await dequeue(m.id); applied++;
          await logActivity({
            kind: "synced", entity, op: m.op, target_id: m.target_id,
          });
        } else if (m.op === "update" && m.target_id) {
          const { data: server, error: sErr } = await sb
            .from(entity).select("*").eq("id", m.target_id).maybeSingle();
          if (sErr) throw sErr;
          if (!server) { await dequeue(m.id); continue; }

          const baseUpdated = m.base_updated_at ?? null;
          const serverUpdated = (server as Record<string, unknown>).updated_at as string | null;
          const changed = baseUpdated && serverUpdated && baseUpdated !== serverUpdated;

          const editable = EDITABLE_FIELDS[entity];
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
              entity,
              target_id: m.target_id,
              local: localChanges,
              server: server as Record<string, unknown>,
              fields: overlapping,
            });
            await dequeue(m.id);
            conflicts++;
            continue;
          }
          const { data, error } = await sb.from(entity)
            .update(localChanges).eq("id", m.target_id).select().maybeSingle();
          if (error) throw error;
          if (data) await putSnapshot(entity, data as { id: string });
          await dequeue(m.id); applied++;
          await logActivity({
            kind: "synced", entity, op: m.op, target_id: m.target_id,
            server_id: (data as { id?: string } | null)?.id ?? null,
          });
        }
      } catch (err) {
        console.warn("[sync] failed", m, err);
        failed++;
        await logActivity({
          kind: "failed", entity: m.entity, op: m.op,
          client_ref: m.client_ref ?? null, target_id: m.target_id ?? null,
          message: err instanceof Error ? err.message : String(err),
        });
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

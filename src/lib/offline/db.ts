// Offline-first data layer using IndexedDB.
// - `snapshots` mirrors read data per-entity so screens work offline.
// - `queue` holds pending mutations to replay when back online.
// - `conflicts` holds unresolved server/local overlaps for user review.

import { openDB, type IDBPDatabase } from "idb";

export type EntityName = "products" | "suppliers" | "sales" | "sale_items" | "settings";

export type OfflineSalePayload = {
  client_ref: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string;
  cash_received: number | null;
  cashier_id: string | null;
  items: Array<{
    product_id: string;
    name_snapshot: string;
    qty: number;
    unit_price: number;
    cost_snapshot: number;
    line_total: number;
  }>;
};

export type QueuedMutation = {
  id: string;
  entity: EntityName | "offline_sale";
  op: "insert" | "update" | "delete" | "sale";
  client_ref?: string;
  target_id?: string;
  base_updated_at?: string | null;
  payload: Record<string, unknown>;
  created_at: number;
};

export type Conflict = {
  id: string;
  entity: EntityName;
  target_id: string;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  fields: string[]; // overlapping fields
  created_at: number;
};

export type ActivityKind =
  | "queued"
  | "synced"
  | "failed"
  | "conflict_detected"
  | "conflict_resolved"
  | "cancelled";

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  entity: EntityName | "offline_sale";
  op?: "insert" | "update" | "delete" | "sale";
  client_ref?: string | null;
  target_id?: string | null;
  server_id?: string | null;
  message?: string | null;
  fields?: string[];
  choice?: "keep_mine" | "keep_server" | null;
  created_at: number;
};

const DB_NAME = "myspot-offline";
const DB_VERSION = 2;

let _db: Promise<IDBPDatabase> | null = null;

export function db() {
  if (typeof window === "undefined") throw new Error("IndexedDB unavailable on server");
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (!d.objectStoreNames.contains("snapshots")) {
          const s = d.createObjectStore("snapshots", { keyPath: ["entity", "id"] });
          s.createIndex("by_entity", "entity");
        }
        if (!d.objectStoreNames.contains("queue")) {
          const q = d.createObjectStore("queue", { keyPath: "id" });
          q.createIndex("by_created", "created_at");
        }
        if (!d.objectStoreNames.contains("conflicts")) {
          d.createObjectStore("conflicts", { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains("meta")) {
          d.createObjectStore("meta");
        }
        if (oldVersion < 2 && !d.objectStoreNames.contains("activity")) {
          const a = d.createObjectStore("activity", { keyPath: "id" });
          a.createIndex("by_created", "created_at");
        }
      },
    });
  }
  return _db;
}


// Snapshot helpers
export async function putSnapshot(entity: EntityName, row: { id: string } & Record<string, unknown>) {
  const d = await db();
  await d.put("snapshots", { entity, ...row });
}
export async function bulkPutSnapshot(entity: EntityName, rows: ({ id: string } & Record<string, unknown>)[]) {
  const d = await db();
  const tx = d.transaction("snapshots", "readwrite");
  for (const r of rows) await tx.store.put({ entity, ...r });
  await tx.done;
}
export async function listSnapshot<T = Record<string, unknown>>(entity: EntityName): Promise<T[]> {
  const d = await db();
  const idx = d.transaction("snapshots").store.index("by_entity");
  return (await idx.getAll(entity)) as T[];
}
export async function getSnapshot<T = Record<string, unknown>>(entity: EntityName, id: string): Promise<T | undefined> {
  const d = await db();
  return (await d.get("snapshots", [entity, id])) as T | undefined;
}
export async function deleteSnapshot(entity: EntityName, id: string) {
  const d = await db();
  await d.delete("snapshots", [entity, id]);
}

// Queue helpers
export async function enqueue(m: Omit<QueuedMutation, "id" | "created_at"> & { id?: string }) {
  const d = await db();
  const rec: QueuedMutation = {
    id: m.id ?? crypto.randomUUID(),
    created_at: Date.now(),
    ...m,
  };
  await d.put("queue", rec);
  await logActivity({
    kind: "queued",
    entity: rec.entity,
    op: rec.op,
    client_ref: rec.client_ref ?? null,
    target_id: rec.target_id ?? null,
  });
  return rec;
}
export async function listQueue(): Promise<QueuedMutation[]> {
  const d = await db();
  return (await d.transaction("queue").store.index("by_created").getAll()) as QueuedMutation[];
}
export async function dequeue(id: string) {
  const d = await db();
  await d.delete("queue", id);
}
export async function queueSize(): Promise<number> {
  const d = await db();
  return d.count("queue");
}

// Conflict helpers
export async function addConflict(c: Omit<Conflict, "id" | "created_at">) {
  const d = await db();
  const rec: Conflict = { id: crypto.randomUUID(), created_at: Date.now(), ...c };
  await d.put("conflicts", rec);
  await logActivity({
    kind: "conflict_detected",
    entity: rec.entity,
    target_id: rec.target_id,
    fields: rec.fields,
  });
  return rec;
}
export async function listConflicts(): Promise<Conflict[]> {
  const d = await db();
  return (await d.getAll("conflicts")) as Conflict[];
}
export async function resolveConflict(id: string, choice?: "keep_mine" | "keep_server") {
  const d = await db();
  const existing = (await d.get("conflicts", id)) as Conflict | undefined;
  await d.delete("conflicts", id);
  if (existing) {
    await logActivity({
      kind: "conflict_resolved",
      entity: existing.entity,
      target_id: existing.target_id,
      fields: existing.fields,
      choice: choice ?? null,
    });
  }
}

// Activity log helpers
export async function logActivity(a: Omit<ActivityEntry, "id" | "created_at"> & { id?: string; created_at?: number }) {
  const d = await db();
  const rec: ActivityEntry = {
    id: a.id ?? crypto.randomUUID(),
    created_at: a.created_at ?? Date.now(),
    ...a,
  };
  await d.put("activity", rec);
  return rec;
}
export async function listActivity(limit = 500): Promise<ActivityEntry[]> {
  const d = await db();
  const all = (await d.transaction("activity").store.index("by_created").getAll()) as ActivityEntry[];
  // newest first
  return all.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}
export async function clearActivity() {
  const d = await db();
  await d.clear("activity");
}

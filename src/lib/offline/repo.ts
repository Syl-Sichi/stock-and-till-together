// High-level offline-aware repository. Screens use these instead of touching supabase directly.
import { supabase } from "@/integrations/supabase/client";
import {
  bulkPutSnapshot, deleteSnapshot, enqueue,
  getSnapshot, listSnapshot, putSnapshot, type EntityName,
} from "./db";
import { emitChange, isOnline } from "./network";

export async function repoList<T = Record<string, unknown>>(entity: EntityName): Promise<T[]> {
  if (isOnline()) {
    const { data, error } = await supabase.from(entity).select("*");
    if (!error && data) {
      await bulkPutSnapshot(entity, data as Array<{ id: string } & Record<string, unknown>>);
      return data as T[];
    }
  }
  return listSnapshot<T>(entity);
}

export async function repoInsert(entity: EntityName, payload: Record<string, unknown>) {
  const client_ref = (payload.client_ref as string | undefined) ?? crypto.randomUUID();
  const full = { ...payload, client_ref };
  if (isOnline()) {
    const { data, error } = await supabase.from(entity).upsert(full, { onConflict: "client_ref" }).select().maybeSingle();
    if (!error && data) {
      await putSnapshot(entity, data as { id: string });
      return data;
    }
    // fall through to enqueue on failure
  }
  // Optimistic local record
  const optimistic = { id: `local-${client_ref}`, ...full, _pending: true };
  await putSnapshot(entity, optimistic as { id: string });
  await enqueue({ entity, op: "insert", client_ref, payload: full });
  emitChange("queue");
  return optimistic;
}

export async function repoUpdate(entity: EntityName, id: string, patch: Record<string, unknown>) {
  const current = await getSnapshot<{ updated_at?: string }>(entity, id);
  const base_updated_at = current?.updated_at ?? null;
  if (isOnline()) {
    const { data, error } = await supabase.from(entity).update(patch).eq("id", id).select().maybeSingle();
    if (!error && data) {
      await putSnapshot(entity, data as { id: string });
      return data;
    }
  }
  const optimistic = { ...(current ?? {}), ...patch, id, _pending: true };
  await putSnapshot(entity, optimistic as { id: string });
  await enqueue({ entity, op: "update", target_id: id, base_updated_at, payload: patch });
  emitChange("queue");
  return optimistic;
}

export async function repoDelete(entity: EntityName, id: string) {
  if (isOnline()) {
    const { error } = await supabase.from(entity).delete().eq("id", id);
    if (!error) { await deleteSnapshot(entity, id); return; }
  }
  await deleteSnapshot(entity, id);
  await enqueue({ entity, op: "delete", target_id: id, payload: {} });
  emitChange("queue");
}

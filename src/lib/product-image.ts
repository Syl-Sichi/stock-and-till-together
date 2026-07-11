import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";

export async function uploadProductImage(file: File): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "anon";
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

const urlCache = new Map<string, { url: string; exp: number }>();

export async function getProductImageUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  // If already a full URL (legacy), return as-is.
  if (path.startsWith("http")) return path;
  const cached = urlCache.get(path);
  if (cached && cached.exp > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

export async function removeProductImage(path: string | null | undefined) {
  if (!path || path.startsWith("http")) return;
  await supabase.storage.from(BUCKET).remove([path]);
  urlCache.delete(path);
}

// Simplified storage broker — no longer tied to any preview platform.
// Returns undefined so Supabase uses its default storage.

export interface PreviewAuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function brokeredPreviewStorage(): PreviewAuthStorage | undefined {
  return undefined;
}

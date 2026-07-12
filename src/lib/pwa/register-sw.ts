// Guarded service worker registration. Never registers in Lovable preview / iframe / dev.
export function shouldRegisterSW(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (!import.meta.env.PROD) return false;
  try { if (window.self !== window.top) return false; } catch { return false; }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return false;
  if (h === "lovableproject.com" || h.endsWith(".lovableproject.com")) return false;
  if (h === "lovableproject-dev.com" || h.endsWith(".lovableproject-dev.com")) return false;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return false;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return false;
  return true;
}

export async function ensureSW(): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegisterSW()) {
    // Best-effort cleanup for stale SWs in preview contexts
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) if (r.active?.scriptURL.endsWith("/sw.js")) await r.unregister();
      } catch { /* noop */ }
    }
    return null;
  }
  return navigator.serviceWorker.register("/sw.js");
}

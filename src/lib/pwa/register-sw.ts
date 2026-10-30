// Service worker registration for the PWA. Only registers in production.
export function shouldRegisterSW(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (!import.meta.env.PROD) return false;
  try {
    if (window.self !== window.top) return false;
  } catch {
    return false;
  }
  if (new URLSearchParams(window.location.search).get("sw") === "off") return false;
  return true;
}

export async function ensureSW(): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegisterSW()) {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          if (r.active?.scriptURL.endsWith("/sw.js")) await r.unregister();
        }
      } catch {
        /* noop */
      }
    }
    return null;
  }
  return navigator.serviceWorker.register("/sw.js");
}

import { ensureSW } from "@/lib/pwa/register-sw";
import { saveSubscription, deleteSubscription } from "./subs.functions";

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined") return { ok: false, reason: "not in browser" };
  if (!("Notification" in window) || !("PushManager" in window)) return { ok: false, reason: "Push not supported on this browser" };
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!key) return { ok: false, reason: "Push not configured" };

  const reg = await ensureSW();
  if (!reg) return { ok: false, reason: "Push works only in the installed / published app" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Notification permission denied" };

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(key) as BufferSource,
  });
  const json = sub.toJSON();
  await saveSubscription({
    data: {
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh!,
      auth: json.keys!.auth!,
      user_agent: navigator.userAgent,
    },
  });
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await deleteSubscription({ data: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
}

export async function isPushEnabled(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return !!sub;
}

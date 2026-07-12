// Server-only push sender. Never import from client code.
import webpush from "web-push";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT || "mailto:owner@myspot.app";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(sub, pub, priv);
  configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export async function sendPushToAll(payload: PushPayload) {
  configure();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (error) throw new Error(error.message);
  const dead: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );
  if (dead.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", dead);
  }
  return { sent: (subs?.length ?? 0) - dead.length, pruned: dead.length };
}

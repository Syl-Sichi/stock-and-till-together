import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disablePush, enablePush, isPushEnabled } from "@/lib/push/subscribe";
import { toast } from "sonner";

export function EnableNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void isPushEnabled().then(setEnabled); }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.success("Notifications disabled");
      } else {
        const r = await enablePush();
        if (r.ok) { setEnabled(true); toast.success("Push notifications enabled"); }
        else toast.error(r.reason ?? "Could not enable notifications");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Button variant={enabled ? "outline" : "default"} onClick={toggle} disabled={busy} className="gap-2">
      {enabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {enabled ? "Disable notifications" : "Enable push notifications"}
    </Button>
  );
}

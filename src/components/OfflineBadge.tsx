import { useEffect, useState } from "react";
import { CloudOff, RefreshCcw, Wifi } from "lucide-react";
import { queueSize } from "@/lib/offline/db";
import { isOnline, onChange, onNetworkChange } from "@/lib/offline/network";
import { runSync } from "@/lib/offline/sync";

export function OfflineBadge() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOnline(isOnline());
    void queueSize().then(setPending);
    const offNet = onNetworkChange(() => {
      setOnline(isOnline());
      void queueSize().then(setPending);
    });
    const offQ = onChange("queue", () => { void queueSize().then(setPending); });
    return () => { offNet(); offQ(); };
  }, []);

  if (online && pending === 0) return null;

  async function syncNow() {
    setBusy(true);
    try { await runSync(); } finally { setBusy(false); void queueSize().then(setPending); }
  }

  return (
    <button
      type="button"
      onClick={syncNow}
      disabled={!online || busy}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${
        online ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-muted text-muted-foreground border-border"
      }`}
      title={online ? "Sync pending changes" : "You are offline. Changes are saved locally."}
    >
      {online ? <Wifi className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
      {online ? (pending > 0 ? `${pending} pending` : "Online") : "Offline"}
      {online && pending > 0 && <RefreshCcw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />}
    </button>
  );
}

// Online/offline detection + change events.
type Listener = () => void;
const listeners = new Set<Listener>();

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function onNetworkChange(fn: Listener): () => void {
  listeners.add(fn);
  const online = () => fn();
  const offline = () => fn();
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}

// Custom event bus for queue/conflict changes
type ChangeKind = "queue" | "conflicts";
const changeListeners = new Map<ChangeKind, Set<Listener>>();

export function emitChange(kind: ChangeKind) {
  changeListeners.get(kind)?.forEach((l) => l());
}
export function onChange(kind: ChangeKind, fn: Listener): () => void {
  if (!changeListeners.has(kind)) changeListeners.set(kind, new Set());
  changeListeners.get(kind)!.add(fn);
  return () => changeListeners.get(kind)?.delete(fn);
}

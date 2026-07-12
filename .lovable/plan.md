
## What you'll get

1. **Full offline mode** — sales, inventory, suppliers, and settings all editable without internet. Changes queue locally and sync when the connection returns.
2. **Conflict prompt** — when your offline edit and a newer server value disagree, a review dialog lists each conflict so you pick the winner (yours / server / merge fields).
3. **Web Push notifications** — real background push (works with the app closed) for:
   - Low-stock alerts (fires the moment quantity crosses your threshold)
   - Daily report ready at 9:00 PM Africa/Lagos
4. **Install & subscribe** — a "Enable notifications" button in Settings that registers the service worker and stores your push subscription.

## How it works (technical)

### Offline layer
- Add a service worker via `vite-plugin-pwa` (`generateSW`, `NetworkFirst` for HTML, `CacheFirst` for hashed assets, guarded so it never registers in Lovable preview).
- IndexedDB store (`idb`) holds:
  - **Snapshots**: last-known `products`, `suppliers`, `settings`, recent `sales` rows (refreshed on every online read).
  - **Mutation queue**: every create/update/delete performed offline, tagged with `entity`, `op`, `local_updated_at`, `payload`, and the base `updated_at` we read from.
- A thin `offlineRepo` wraps reads/writes. Online: writes go straight to Supabase then update the snapshot. Offline: writes hit the snapshot + queue. UI reads always come from the snapshot, so screens stay live.
- POS sales get a local `client_ref` UUID; when synced they upsert by `client_ref` so replays are idempotent.

### Sync + conflict prompt
- A `SyncManager` runs on `online` event, on app start, and every 60 s.
- For each queued mutation it re-reads the current server row, compares `updated_at` against the base version:
  - No server change → apply.
  - Server changed but fields don't overlap → auto-merge.
  - Overlapping fields → push into a **conflicts** list.
- A toast + banner surfaces "N conflicts to resolve" and opens a dialog listing entity, field, your value, server value, and Keep mine / Keep server / Merge (field-level) buttons.

### Push notifications
- Generate VAPID keys, store the public key in a client env var and the private key as a secret.
- New table `push_subscriptions (user_id, endpoint, p256dh, auth, created_at)` with RLS (owner-only).
- New table `notification_log` to dedupe (so we don't re-alert for the same low-stock item twice a day).
- Service worker handles `push` events → shows notification, click deep-links into the app.
- Server function `sendPushToUser` uses the `web-push` library.
- **Low-stock trigger**: Postgres trigger on `products` fires when `quantity` crosses `<= min_stock`, calls a `/api/public/hooks/low-stock` route (via `pg_net`) which fans out push messages.
- **Daily report**: `pg_cron` job at 21:00 Africa/Lagos calls `/api/public/hooks/daily-report`, which generates the summary and pushes to every subscriber.

### Files added / changed
- `vite.config.ts` — add `vite-plugin-pwa`
- `src/lib/offline/db.ts`, `queue.ts`, `sync.ts`, `repo.ts`
- `src/lib/offline/conflicts.ts` + `src/components/ConflictDialog.tsx`
- `src/lib/push/subscribe.ts`, `src/lib/push/send.functions.ts`
- `src/routes/api/public/hooks/low-stock.ts`, `daily-report.ts`
- `src/components/OfflineBadge.tsx`, `src/components/EnableNotifications.tsx`
- `public/sw.js` registration wrapper (guarded)
- Migrations: `push_subscriptions`, `notification_log`, low-stock trigger, cron schedule
- Wire `pos.tsx`, `inventory.tsx`, `suppliers.tsx`, `settings.tsx` to `offlineRepo`

### Caveats
- Offline works only in the **published** app (service workers don't run in Lovable preview by design). You'll see the offline badge/queue there.
- iOS requires the app to be installed to Home Screen before it can receive web push.
- You'll need to click "Enable notifications" once per device to subscribe.

Reply "go" to build it, or tell me what to change.

# My Spot — Build Plan (v1)

A clean, Shopify-style POS & inventory app in Naira, installable as a PWA, with an AI inventory assistant.

## Foundation
- Enable **Lovable Cloud** (Postgres + Auth + Storage).
- Design system: white/gray surfaces, `#16a34a` primary green, dark ink `#111827`; Inter + a slightly heavier display face for headings; rounded cards, subtle shadows.
- Semantic tokens in `src/styles.css`; shadcn variants only — no hardcoded colors in components.
- Manifest-only PWA: `manifest.webmanifest`, icons, theme color, `apple-touch-icon`. No service worker in v1.

## Data model (Supabase)
- `profiles` (id → auth.users, full_name)
- `user_roles` (user_id, role: owner|manager|cashier) + `has_role()` SECURITY DEFINER
- `categories`, `suppliers`
- `products` (name, sku, barcode, category_id, supplier_id, image_url, cost_price, selling_price, quantity, min_stock, expiry_date, archived)
- `sales` (id, cashier_id, subtotal, discount, tax, total, payment_method, cash_received, created_at)
- `sale_items` (sale_id, product_id, name_snapshot, qty, unit_price, cost_snapshot, line_total)
- `restocks` (product_id, supplier_id, qty, unit_cost, created_by, created_at)
- `settings` (singleton: store_name, currency, tax_rate, low_stock_threshold, receipt_footer)
- RLS: authenticated users read; only manager/owner write products/suppliers; only owner deletes; cashiers can insert sales. Triggers decrement `products.quantity` on `sale_items` insert and increment on `restocks` insert.
- Full GRANTs per public-schema rules.

## Routes
```
/auth                     login / signup
/_authenticated/
  index                   Dashboard
  pos                     Point of Sale
  inventory               Product list + add/edit/archive
  inventory/$id           Product detail
  restock                 Add stock
  sales                   Sales history + receipt view
  reports                 Daily / weekly / monthly + export CSV
  suppliers               Suppliers CRUD
  assistant               AI chat
  settings                Store settings + role management (owner)
```

## Features in v1
- **Auth & roles**: email/password + Google. Role gates for delete/settings.
- **Inventory**: CRUD, image upload to Storage, search/filter/sort, low-stock badge, CSV import/export.
- **Barcode**: manual entry + phone camera scan (`@zxing/browser`); USB scanners work as keyboard input automatically.
- **POS**: cart, quantity, discount %, tax from settings, cash/transfer/card/split, prints A5/thermal-friendly receipt with `window.print()`. Auto-decrements stock via DB trigger.
- **Dashboard**: today's revenue, profit (from cost snapshot), tx count, items sold, inventory value, low/out-of-stock, top sellers, 7-day and 30-day revenue charts (Recharts).
- **Reports**: daily/weekly/monthly tables + charts + CSV export.
- **AI Assistant**: streaming chat (TanStack `/api/chat` server route + AI SDK + Lovable AI Gateway, `openai/gpt-5.5`). Tools:
  - `get_inventory_summary`, `find_product(query)`, `low_stock`, `top_sellers(period)`, `slow_movers(period)`, `sales_summary(period)`, `reorder_suggestions`.
  Tools query Supabase server-side with `requireSupabaseAuth`.
- **Notifications**: in-app bell showing low-stock / expiring-soon items (client query, no push in v1).

## Branding & SEO
- Real `head()` per route (title, description, og).
- `sitemap.xml`, `robots.txt`, `llms.txt` for public `/auth` only.

## Out of scope (future)
Offline sync, push notifications, multi-branch, loyalty, payroll, WhatsApp/SMS, voice AI, camera product recognition, payment gateway integration.

---

## Deliverable in this pass
I'll ship the foundation end-to-end: Cloud enabled, schema + RLS + triggers, design system, auth, dashboard, inventory (CRUD + barcode scan), POS (checkout + receipt), sales history, reports (daily + CSV), AI assistant, settings, PWA manifest, sitemap/robots. Some polish (bulk import UI, advanced filters, weekly/monthly report exports) may land as follow-ups if the turn budget runs long — I'll flag anything deferred.

Approve and I'll start building.

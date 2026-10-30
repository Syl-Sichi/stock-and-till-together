# My Spot POS

AI-Powered Inventory Management & Point of Sale system for supermarkets.

## Overview

Modern, professional inventory and POS web application (Progressive Web App) that works both **online and fully offline**.

- Full offline support for sales, inventory, and core operations with automatic background sync
- AI assistant that works offline (queries local data) and online (cloud models)
- Installable on Android, iOS, Windows, and macOS
- Real-time sync via Supabase when connectivity is available
- Role-based access control (Owner, Manager, Cashier)

## Tech Stack

- React + TypeScript
- TanStack Start / Router
- Supabase (Auth, Database, Storage, Realtime)
- Tailwind CSS + shadcn/ui
- PWA with service worker
- IndexedDB for offline data
- Vercel AI SDK for online AI features

## Getting Started

```bash
npm install
cp .env.example .env   # fill in your Supabase + AI keys
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

- Supabase URL and anon/public key
- Optional: `OPENAI_API_KEY` (or compatible provider) for online AI
- Optional: VAPID keys for push notifications

**Never commit the real `.env` file.**

## Offline & Online Behaviour

The application is built offline-first:

- POS sales, inventory views, and core operations work without internet
- Changes are queued locally and automatically synced when the device comes back online
- The AI assistant answers from local IndexedDB data when offline and uses cloud models when online

## Branding

Logo and visual assets will be updated once provided by the client.  
Current placeholder branding is **My Spot**.

## License

Private / client project.

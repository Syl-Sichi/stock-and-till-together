# My Spot POS

AI-Powered Inventory Management & Point of Sale system for supermarkets.

## Overview

Modern, professional inventory and POS web application (PWA) that works online and offline.

- Full offline support for sales, inventory, and core operations with automatic sync.
- AI assistant that works offline using local data and online with cloud models.
- Installable on Android, iOS, Windows, and macOS.
- Real-time sync via Supabase when online.
- Role-based access (Owner, Manager, Cashier).

## Tech Stack

- React + TypeScript
- TanStack Start / Router
- Supabase (Auth, Database, Storage, Realtime)
- Tailwind CSS + shadcn/ui
- PWA with service worker
- IndexedDB for offline data
- Vercel AI SDK for online AI

## Getting Started

```bash
npm install
cp .env.example .env   # fill in your Supabase keys
npm run dev
```

## Environment Variables

See `.env` for required Supabase and VAPID keys. For AI, set `OPENAI_API_KEY` or compatible provider.

## Offline & Online

The app is a Progressive Web App. Core POS and inventory operations work fully offline and sync when connectivity returns. The AI assistant falls back to local data queries when offline.

## Branding

Logo and assets will be updated once provided. Current branding is "My Spot".

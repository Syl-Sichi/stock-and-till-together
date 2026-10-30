# My Supermarket — Farms and Stores

AI-Powered Inventory Management & Point of Sale system for supermarkets.

## Overview

Modern, professional inventory and POS web application (Progressive Web App) that works both **online and fully offline**.

- Full offline support for sales, inventory, and core operations with automatic background sync
- AI assistant that works offline (queries local data) and online (cloud models)
- Installable on Android, iOS, Windows, and macOS
- Real-time sync via Supabase when connectivity is available
- Role-based access control (Owner, Manager, Cashier)

## Branding

**My Supermarket Farms and Stores**  
Primary color: Red (logo red `#DC2626`)

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

Copy `.env.example` to `.env` and fill in the values.

**Never commit the real `.env` file.**

## Offline & Online Behaviour

The application is built offline-first. Core POS and inventory operations work without internet and sync automatically when connectivity returns. The AI assistant falls back to local data when offline.

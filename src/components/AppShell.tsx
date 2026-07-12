import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Package,
  ScanBarcode,
  Receipt,
  BarChart3,
  Users2,
  Sparkles,
  Settings as SettingsIcon,
  LogOut,
  ShoppingBasket,
  Menu,
  X,
  PackagePlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { InstallPWA } from "@/components/InstallPWA";
import { OfflineBadge } from "@/components/OfflineBadge";
import { ConflictBanner } from "@/components/ConflictDialog";
import { startSyncLoop } from "@/lib/offline/sync";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pos", label: "Point of Sale", icon: ScanBarcode },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/restock", label: "Restock", icon: PackagePlus },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/suppliers", label: "Suppliers", icon: Users2 },
  { to: "/assistant", label: "AI Assistant", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => { startSyncLoop(); }, []);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform lg:translate-x-0 lg:static ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-sidebar-border">
          <Link to="/dashboard" className="flex items-center gap-2 font-display font-bold text-lg text-sidebar-foreground">
            <span className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
              <ShoppingBasket className="h-4 w-4" />
            </span>
            My Spot
          </Link>
          <button className="lg:hidden text-sidebar-foreground" onClick={() => setOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="px-2 py-2 text-xs text-sidebar-foreground/60 capitalize">
            Role: {role ?? "…"}
          </div>
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b bg-card flex items-center px-4 lg:px-6 gap-3 sticky top-0 z-20">
          <button className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="font-display font-semibold text-base capitalize">
            {nav.find((n) => location.pathname.startsWith(n.to))?.label ?? "My Spot"}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ConflictBanner />
            <OfflineBadge />
            <InstallPWA />
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

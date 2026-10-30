import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import appCss from "@/styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "My Supermarket — Inventory & POS for retail" },
      {
        name: "description",
        content:
          "My Supermarket is an AI-powered inventory management and point of sale system that helps shops track stock, ring up sales, and grow smarter.",
      },
      { property: "og:title", content: "My Supermarket — Inventory & POS for retail" },
      { name: "theme-color", content: "#DC2626" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground">The page you requested does not exist.</p>
      </div>
    </div>
  ),
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body className="min-h-screen bg-background text-foreground antialiased">
          <Outlet />
          <Toaster richColors position="top-right" />
          <Scripts />
        </body>
      </html>
    </QueryClientProvider>
  );
}

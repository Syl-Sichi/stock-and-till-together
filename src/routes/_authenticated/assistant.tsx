import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Bot, Send, Sparkles, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isOnline } from "@/lib/offline/network";
import { listSnapshot } from "@/lib/offline/db";

export const Route = createFileRoute("/_authenticated/assistant")({
  component: Assistant,
});

const SUGGESTIONS = [
  "What items are running low on stock?",
  "How many Akara are left?",
  "How much revenue did I make today?",
  "Which products sold the most this week?",
  "What should I reorder?",
];

async function answerLocally(question: string): Promise<string> {
  const q = question.toLowerCase();
  const products = await listSnapshot<any>("products");
  const sales = await listSnapshot<any>("sales");
  const items = await listSnapshot<any>("sale_items");

  if (q.includes("low") || q.includes("reorder") || q.includes("finished") || q.includes("stock")) {
    const low = products.filter((p: any) => Number(p.quantity) <= Number(p.min_stock || 0));
    if (low.length === 0) return "No products are currently below their minimum stock level.";
    return (
      "**Low / out-of-stock items (from local data):**\n\n" +
      low
        .map(
          (p: any) =>
            `- **${p.name}**: ${p.quantity} left (min ${p.min_stock || 0})` +
            (p.quantity <= 0 ? " — **OUT OF STOCK**" : ""),
        )
        .join("\n")
    );
  }

  if (q.includes("revenue") || q.includes("profit") || q.includes("today") || q.includes("sold")) {
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = sales.filter((s: any) => (s.created_at || "").startsWith(today));
    const revenue = todaySales.reduce((a: number, s: any) => a + Number(s.total || 0), 0);
    const todayItems = items.filter((i: any) => (i.created_at || "").startsWith(today));
    const profit = todayItems.reduce(
      (a: number, i: any) =>
        a + (Number(i.unit_price || 0) - Number(i.cost_snapshot || 0)) * Number(i.qty || 0),
      0,
    );
    return (
      `**Today (local data):**\n` +
      `- Revenue: ₦${revenue.toLocaleString()}\n` +
      `- Profit: ₦${profit.toLocaleString()}\n` +
      `- Transactions: ${todaySales.length}`
    );
  }

  // Product specific search
  const match = products.find(
    (p: any) =>
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.barcode?.includes(q),
  );
  if (match) {
    return (
      `**${match.name}**\n` +
      `- Quantity: ${match.quantity}\n` +
      `- Min stock: ${match.min_stock || "not set"}\n` +
      `- Selling price: ₦${Number(match.selling_price || 0).toLocaleString()}\n` +
      (match.quantity <= (match.min_stock || 0)
        ? "\n**Red alert — restock now.**"
        : "")
    );
  }

  return (
    "I'm running in **offline mode**. I can answer questions about current stock levels, low-stock items, and today's sales using the data already on this device.\n\n" +
    "Try asking: “What is low on stock?” or “How much revenue today?”"
  );
}

function Assistant() {
  const [input, setInput] = useState("");
  const [offlineMessages, setOfflineMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [online, setOnline] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const check = () => setOnline(isOnline());
    check();
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (url, init) => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const headers = new Headers(init?.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(url, { ...init, headers });
      },
    }),
    onError: (error) => {
      toast.error("The AI assistant could not respond", {
        description: error.message,
      });
    },
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, offlineMessages, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    if (!online) {
      setOfflineMessages((m) => [...m, { role: "user", text: text.trim() }]);
      const answer = await answerLocally(text.trim());
      setOfflineMessages((m) => [...m, { role: "assistant", text: answer }]);
    } else {
      await sendMessage({ text: text.trim() });
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const displayMessages = online
    ? messages.map((m) => ({
        role: m.role as "user" | "assistant",
        text: m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""),
      }))
    : offlineMessages;

  return (
    <div className="max-w-3xl mx-auto">
      <Card className="p-0 overflow-hidden flex flex-col h-[calc(100vh-10rem)]">
        <div className="p-4 border-b flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
            {online ? <Sparkles className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          </div>
          <div>
            <div className="font-semibold">My Spot Assistant</div>
            <div className="text-xs text-muted-foreground">
              {online
                ? "Ask about stock levels, sales, and what to reorder."
                : "Offline mode — answering from data stored on this device."}
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4">
          {displayMessages.length === 0 && (
            <div className="space-y-4">
              {!online && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                    <WifiOff className="h-4 w-4" /> Offline mode
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Answers come from the inventory and sales data already cached on this device.
                  </p>
                </div>
              )}
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Stock watch is active
                </div>
                <p className="mt-1 text-muted-foreground">
                  Ask about any item and I will check current stock, low-stock status, sales, and
                  reorder advice from your shop data.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">Try one of these:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="text-left text-sm rounded-lg border p-3 hover:border-primary hover:bg-accent/50 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {displayMessages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.role === "assistant" ? (
                  <div className="flex gap-2">
                    <Bot className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                      <ReactMarkdown>{m.text || (busy ? "…" : "")}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  m.text
                )}
              </div>
            </div>
          ))}

          {online && status === "submitted" && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-4 py-2.5 text-sm">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0.3s]" />
                </span>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="p-3 border-t flex gap-2"
        >
          <Input
            ref={inputRef}
            placeholder={online ? "Ask about your shop…" : "Ask about stock or sales (offline)…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Bot, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

function Assistant() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, [messages, status]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    await sendMessage({ text: text.trim() });
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card className="p-0 overflow-hidden flex flex-col h-[calc(100vh-10rem)]">
        <div className="p-4 border-b flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold">My Spot Assistant</div>
            <div className="text-xs text-muted-foreground">
              Ask about stock levels, sales, and what to reorder.
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="space-y-4">
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

          {messages.map((m) => {
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            return (
              <div
                key={m.id}
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
                        <ReactMarkdown>{text || (busy ? "…" : "")}</ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    text
                  )}
                </div>
              </div>
            );
          })}

          {status === "submitted" && (
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
            placeholder="Ask about your shop…"
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

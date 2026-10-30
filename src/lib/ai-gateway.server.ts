import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Creates an AI provider. Uses OPENAI_API_KEY or OPENAI_COMPATIBLE_BASE_URL from env.
 * Falls back gracefully if no key is present (caller should handle).
 */
export function createAiProvider() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("No AI API key configured. Set OPENAI_API_KEY for online AI features.");
  }

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL,
    apiKey,
  });
}

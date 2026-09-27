import { createServerFn } from "@tanstack/react-start";
import { GROK_MODEL } from "./types.ts";

type WireMessage = { role: "system" | "user" | "assistant"; content: string };

const MAX_MESSAGES = 24;
const MAX_CONTENT = 12000;

function readText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const row = message as { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
  const content = visibleText(row.content);
  if (content) return content;
  const reasoning = typeof row.reasoning_content === "string" ? row.reasoning_content : row.reasoning;
  return visibleText(reasoning);
}

function visibleText(content: unknown): string {
  const raw = Array.isArray(content)
    ? content
        .map((part) => {
          if (typeof part === "string") return part;
          if (!part || typeof part !== "object") return "";
          const row = part as { type?: unknown; text?: unknown };
          if (row.type === "reasoning" || row.type === "thinking") return "";
          return typeof row.text === "string" ? row.text : "";
        })
        .join("\n")
    : typeof content === "string"
      ? content
      : "";
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/<\/?think>/gi, " ").trim();
}

export const probeGrok = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(async () => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "Grok сейчас недоступен. Можно переключиться на OpenRouter." };
    }
    try {
      const response = await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined);
        const denied = response.status === 401 || response.status === 403;
        return {
          ok: false as const,
          error: denied
            ? "Не удалось подключиться к Grok: сервер отклонил ключ."
            : `Не удалось подключиться к Grok (${response.status}).`,
        };
      }
      await response.arrayBuffer().catch(() => undefined);
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Не удалось подключиться к Grok: нет соединения." };
    }
  });

export const askGrok = createServerFn({ method: "POST" })
  .validator((input: unknown): { messages: WireMessage[]; temperature: number; maxTokens: number } => {
    if (!input || typeof input !== "object") throw new Error("Пустой запрос к Grok.");
    const raw = input as { messages?: unknown; temperature?: unknown; maxTokens?: unknown };
    if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > MAX_MESSAGES) {
      throw new Error("Некорректный диалог.");
    }
    const messages: WireMessage[] = raw.messages.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Некорректное сообщение.");
      const row = item as { role?: unknown; content?: unknown };
      const role = row.role === "system" || row.role === "user" || row.role === "assistant" ? row.role : null;
      if (!role || typeof row.content !== "string" || !row.content.trim()) {
        throw new Error("Некорректное сообщение.");
      }
      return { role, content: row.content.slice(0, MAX_CONTENT) };
    });
    const temperature =
      typeof raw.temperature === "number" && Number.isFinite(raw.temperature)
        ? Math.min(1.2, Math.max(0, raw.temperature))
        : 0.8;
    const maxTokens =
      typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens)
        ? Math.min(2400, Math.max(64, Math.round(raw.maxTokens)))
        : 1200;
    return { messages, temperature, maxTokens };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "Grok сейчас недоступен. Можно переключиться на OpenRouter." };
    }
    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROK_MODEL,
          temperature: data.temperature,
          max_tokens: Math.min(2400, data.maxTokens + 256),
          reasoning_effort: "low",
          messages: data.messages,
        }),
      });
    } catch {
      return { ok: false as const, error: "Нет соединения с Grok." };
    }
    const body = await response.text();
    if (!response.ok) {
      return { ok: false as const, error: grokStatus(response.status, body) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false as const, error: "Grok вернул не JSON." };
    }
    const text = readText(parsed);
    if (!text) return { ok: false as const, error: "Grok вернул пустой ответ." };
    return { ok: true as const, text };
  });

function grokStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return "Grok отклонил запрос. Попробуйте ещё раз или переключитесь на OpenRouter.";
  if (status === 429) return "Grok просит подождать: слишком много запросов.";
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message || parsed.message || "";
  } catch {
    detail = body.trim().slice(0, 180);
  }
  return detail ? `Grok: ${detail}` : `Ошибка Grok (${status}).`;
}
